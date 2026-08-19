# Stripe payments — session handoff

**Date:** 2026-08-19
**Branch:** `directus-migration` (no branch was created — work is in the tree)
**Status:** all 18 planned tasks implemented and reviewed. **Nothing committed.**

This is the state-of-play document. The design lives in
`specs/2026-08-19-stripe-payments-design.md`, the task-by-task plan in
`plans/2026-08-19-stripe-payments.md`, and the durable rules have already been
written into `CLAUDE.md`. This file records what a fresh session would otherwise
have to reconstruct: what was verified, what was not, what broke along the way,
and what to do next.

---

## 1. What exists now

Stripe **test-mode** payments, end to end in code:

- Hosted Checkout — the buyer leaves for `checkout.stripe.com` and returns to
  `/confirmation?session_id=…`. No Stripe JS in the browser, no publishable key.
- The order is created **`pending` before the redirect and holds stock**.
- Payment is confirmed by whichever of three paths gets there first: the signed
  webhook, the confirmation page retrieving the session, or the reconciliation
  sweep.
- Abandoned checkouts release their stock immediately (`/api/orders/abandon`),
  not after 45 minutes.
- Refunds: full on cancel, or per line and quantity, with `refunded_quantity`
  feeding straight back into the availability formula so refunded coffee goes
  back on sale.

### New files

| File | Responsibility |
| --- | --- |
| `server/utils/stripe.ts` | Stripe client, `siteUrl()`, pinned wire API version |
| `server/utils/payments.ts` | Every write to payment/refund fields. `markPaid`, `markExpired`, `refund`, `sweepExpired`, `createCheckoutSession`, `readFullOrder`, `orderBySessionId` |
| `server/api/webhooks/stripe.post.ts` | Signature verification and event dispatch |
| `server/api/orders/by-session.get.ts` | Confirmation page data + Stripe-retrieve repair |
| `server/api/orders/abandon.post.ts` | Releases stock when the buyer backs out |
| `server/api/admin/orders/[id]/refund.post.ts` | Partial refunds, admin-gated |
| `server/utils/email/refunded.ts` | Fourth mail template |
| `app/components/RefundDialog.vue` | Per-line refund picker |

### Modified

`CLAUDE.md`, `README.md`, `.env.example`, `directus/setup.ts`, `directus/seed.ts`,
`shared/types/directus.ts`, `shared/utils/cancelReasons.ts`,
`server/utils/stock.ts`, `server/api/orders.post.ts`,
`server/api/admin/orders.get.ts`, `server/api/admin/orders/[id].patch.ts`,
`server/api/dev/preview-mail.get.ts`, `server/utils/email/shell.ts`,
`server/utils/email/canceled.ts`, `app/pages/checkout.vue`,
`app/pages/confirmation.vue`, `app/pages/admin.vue`, `app/stores/cart.ts`,
`app/components/CancelDialog.vue`.

---

## 2. What is verified, and what is NOT

**Verified by running it:**

- Stock drops when an order is `pending` and unpaid (12 → 11, observed).
- Stock returns on expiry and on abandon (15 → 13 → 15, observed).
- The duplicate-line oversell is refused (2 lines × qty 9 against 11 available
  → 400, availability unchanged).
- Webhook rejects unsigned and badly-signed requests (400), accepts genuinely
  signed events (200), returns 200 for unknown sessions and unknown event types.
- `checkout.session.expired` flips an order to `expired`/`canceled` and returns
  its stock.
- `/api/orders/by-session` returns exactly twelve allow-listed keys with no leak
  of `user`, `cancel_reason`, `cancel_note`, `stripe_payment_intent`,
  `stripe_session_id`, `paid_at` or `refunded_cents`.
- All four mail templates render; the cancellation mail stops claiming "Nothing
  has been charged" when money was returned.
- `directus:setup` and `directus:seed` are idempotent (second run clean).
- Typecheck green across all four TS projects.

**NOT verified — be honest about this:**

- **No payment has completed end to end.** The two successful payments visible
  in the Stripe dashboard are `$30.00 USD` with empty metadata: they are
  `stripe trigger` fixtures, not browser checkouts. Every real session we
  created is EUR, carries `order_id`/`order_number` metadata, and reads
  `expired unpaid`.
- **No refund has ever been issued.** Not one euro has moved through `refund()`.
  Every guard is traced and typechecked; the happy path has never executed.
- The admin dashboard has never been loaded with a session — no click-through of
  the refund dialog, the shipping guard, or the reopen rule.

---

## 3. Bugs found and fixed during the work

Recorded because most were defects in the *plan*, not the implementation, and
because several would have been very hard to find later.

| Bug | Consequence if shipped |
| --- | --- |
| `expires_at` set to Stripe's exact 30-minute minimum | `Math.floor` plus network latency lands the delta at 1799 vs a required 1800 → **20–40% of checkouts 400 after the order already holds stock** |
| `orderBySessionId(undefined)` | `JSON.stringify` drops undefined, the operator vanishes, Directus reads no constraint → **returns a stranger's order**; `markExpired` would cancel it |
| Duplicate `productId` in a cart payload | Each line checked against the same availability figure → **oversell** (2×9 against 11 in stock) |
| Missing `limit: -1` on the stock aggregate (pre-existing) | Directus caps at 100 **group** rows → a product silently reads `held = 0` → **oversell** |
| Sweep expiring on the local clock alone | Pay at minute 29, lose the webhook → **paid order cancelled, no refund, no mail** |
| Duplicate `itemId` in one refund | Both capped against the same stale value, second write overwrites → **Stripe refunds 4 units, row records 2** |
| Refund `requestId` minted per submit | A retry after a failed write takes a **second real refund** |
| `markPaid` ignoring `status` | Money arriving for a cancelled order → marked paid **and a confirmation sent** |
| `markExpired` ignoring `status` | Sweep **overwrites an admin's cancel reason and destroys their note** |
| `readFullOrder` outside the mail `.catch` | Directus blip after the paid write → **buyer charged, never emailed, retry silently skips** |
| Refund-on-cancel with no payment-intent branch | **Six live orders became permanently un-cancellable** |
| Unbounded sweep inside checkout | An 80-order backlog makes the next buyer wait ~24s |
| `placing` never reset on bfcache restore | Browser back from Stripe → **permanently dead button** |
| Abandoned order held for 45 min | Buyer's own retry refused **"only 0 left"** on stock they hold |
| Cart cleared only in `onMounted` | Payment confirmed via "Check again" → **completed order, full cart** |
| `CLAUDE.md` typecheck command | `.nuxt/tsconfig.json` excludes `server/**` → **the project's only mechanical check never saw the backend** |

---

## 4. Environment state

- `.env` holds `STRIPE_SECRET_KEY` (`sk_test_`, verified `livemode: false`),
  `STRIPE_WEBHOOK_SECRET`, and `SITE_URL=http://localhost:3000`.
- Stripe CLI installed via winget at
  `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Stripe.StripeCli_…\stripe.exe`.
  **Not on PATH in an already-open terminal** — winget updates the registry PATH
  but a running VS Code keeps its stale copy. Fix in-session with:
  ```powershell
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  ```
- `stripe login` was never run and is **not needed** — `stripe listen --api-key`
  works directly with the key already in `.env`.
- **The webhook signing secret has been printed into agent transcripts twice.**
  Test-mode, machine-local, gitignored. Starting a fresh `stripe listen` retires
  it; do that rather than reusing a long-lived forwarder.

### Two hazards that cost real time

- **Never run two `yarn dev` instances.** They share
  `node_modules/.cache/nuxt/.nuxt` and stomp each other. The symptom is bizarre:
  Rollup insisting it cannot resolve a file that is plainly on disk. Cure is
  kill both, `rm -rf node_modules/.cache/nuxt`, start one.
- **`netstat` output is localised.** On this machine it prints `ABHÖREN`, not
  `LISTENING`, so a grep for `LISTENING` silently finds nothing and a "kill the
  old server" step does nothing at all. That is how the double-instance
  situation arose.

---

## 5. What to do next

### Finish the verification (needs a browser — nobody else can do it)

1. `http://localhost:3000/shop` → add **House Espresso Classic** to the cart.
2. Check out. **Use a real email you can read** — order mail goes through the
   company SMTP server and reaches real inboxes.
3. Pay with `4242 4242 4242 4242`, any future expiry, any CVC.
4. Expect: redirect to `/confirmation`, green tick, order number, **empty cart
   badge**, a confirmation email, and `checkout.session.completed … [200]` in
   the `stripe listen` terminal.
5. In Directus the order should read `payment_status: paid` with a `pi_…`
   intent, and its stock should stay dropped — it is a sale now, not a hold.

### Then prove the refund path

6. Sign in at `/admin`, expand that order, click **Refund items…**, refund one
   line, confirm.
7. Expect: a refund in the Stripe dashboard for `unit_price × qty` only, the row
   badge reading `part. refunded`, the refund email, and **`stock_available` up
   by exactly that quantity**.
8. Then cancel the order and expect a **further** refund of the shipping only.

### Also worth trying

- Back out of Stripe instead of paying: the cart should survive and the stock
  should return **immediately**, not in 45 minutes.
- Try to mark an unpaid order as shipped: expect 409.
- Try to reopen a refunded order: expect 409.

---

## 6. Suggested commits

Two are independent of Stripe and worth landing first:

```
Fix the documented typecheck to actually cover server/

.nuxt/tsconfig.json is the app project and excludes server/**, so every
Nitro route and server/utils file was silently unchecked. --build
tsconfig.json covers all four project references.
```

```
Add limit: -1 to the stock aggregate

Directus caps a query at 100 rows and the cap applies to group rows, so
past 100 products with open lines one would silently read held = 0 and
the shop would offer committed stock. Pre-existing; availabilityFor()
below it always passed the flag.
```

Then the feature, sliced however you prefer — schema, payment core, client flow,
admin and refunds, docs. The plan's appendix has a single-commit message if you
would rather not split it.

---

## 7. Known limitations, carried forward

- Test mode only. No live keys, ever.
- Refund lifecycle events (`charge.refund.updated`) are not handled: a card
  refund that fails asynchronously leaves the row saying refunded, the stock
  back on sale, and the customer without their money.
- `withLock` is in-process — single Nitro instance only, and **not re-entrant**
  (it deadlocks permanently with no timeout).
- Partial refunds never return shipping; only cancel does.
- A paid-but-cancelled order (money arriving after an admin cancel) has no
  automatic handling — it logs `REFUND THIS MANUALLY` and the refund dialog is
  the manual route.
- The stable `cancel:<id>` idempotency key self-heals a partial write failure
  only inside Stripe's 24-hour window. Past that, retrying a cancel whose refund
  already landed will error and needs a hand-edit of `refunded_cents`.
- `/api/orders/by-session` and `/api/orders/abandon` are unauthenticated by
  design — guest checkout means there is no session to require. The Stripe
  session id and the order uuid are capability tokens. **Do not widen
  `by-session`'s field allow-list.**
