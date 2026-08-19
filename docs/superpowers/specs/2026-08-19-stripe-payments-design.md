# Stripe payments — design

**Date:** 2026-08-19
**Branch:** `stripe-payments`, off `directus-migration`
**Status:** approved, not yet implemented

Replaces the fake card form on `/checkout` with a real Stripe integration in
**test mode**: hosted Checkout, signed webhooks, a payment state machine,
automatic stock release for abandoned checkouts, and refunds — full on cancel,
or per line and quantity, with the refunded coffee going back on sale. No real
money, ever — test mode is the destination, not a stepping stone.

---

## 1. Why Stripe, and why hosted Checkout

Three providers were considered seriously.

- **Stripe** — test keys on email signup, no business verification. The
  deciding factor is the **Stripe CLI**: `stripe listen --forward-to` delivers
  real, real-signed webhook events to `localhost` with no tunnel and no public
  URL. Nothing else on the list can do that, and this project has no stable
  public dev URL.
- **PayPal** — sandbox with paired business/personal test accounts, and Orders
  v2 can capture on the buyer's return so a working integration needs no
  webhooks at all. That is exactly why it was rejected: skipping webhooks
  skips the part worth learning.
- **Mollie** — the most EU-native (SEPA, Klarna, card, PayPal through one
  API), free test keys. Rejected because its flow is genuinely webhook-driven
  and it ships no CLI forwarder, so local development needs a tunnel.

Adyen was dismissed on onboarding weight. Paddle and Lemon Squeezy are
merchants-of-record for **digital** goods and will not process physical
coffee at all.

**Hosted redirect over embedded Checkout or Payment Elements.** All three
share identical server code — same Session object, same webhooks — so this is
purely a client-side choice and is cheap to revisit. Redirect was chosen
because the interesting work here is the server-side state machine, and
because it keeps Stripe entirely out of the browser: **no Stripe JS, no
publishable key, no PCI surface.**

---

## 2. Data model

The central decision: **`status` and payment are two different things and must
not be merged into one enum.**

`eo_orders.status` (`open` / `marked` / `canceled`) stays exactly what it is
today — *fulfillment*. A new `payment_status` tracks money. Six new fields on
`eo_orders` and one on `eo_order_items`, added idempotently by
`directus:setup`:

**`eo_orders`**

| field | type | notes |
| --- | --- | --- |
| `payment_status` | string enum | `pending` \| `paid` \| `expired`, default `pending`, not null |
| `stripe_session_id` | string, unique | idempotency key and lookup key |
| `stripe_payment_intent` | string, nullable | for tracing, and what refunds are issued against |
| `paid_at` | timestamp, nullable | stamped by the paid transition |
| `refunded_cents` | integer, default 0, not null | accumulated across every refund |
| `refunded_at` | timestamp, nullable | most recent refund |

**`eo_order_items`**

| field | type | notes |
| --- | --- | --- |
| `refunded_quantity` | integer, default 0, not null | ≤ `quantity`; drives both the refund total and the restock |

### Refund state is derived, not stored

There is no `refunded` payment state, and deliberately no
`partially_refunded` one. Refund state falls out of two numbers:

```
refunded_cents == 0              → not refunded
0 < refunded_cents < total_cents → partially refunded
refunded_cents == total_cents    → fully refunded
```

This is the same move as derived stock, applied to money, and it earns the
same things: no enum to keep in sync with the amounts, no transition that can
disagree with the ledger, and partial refunds cost a comparison rather than a
new state. **Full refund is a special case of partial**, so there is one code
path, not two.

It also settles where refund history lives: **Stripe is the ledger.** Every
individual refund is already recorded against the payment intent, with its
own id, amount and timestamp, visible in the dashboard. We store only the
accumulated totals needed to derive state and stock — so there is no refund
JSON blob on the order and no `eo_refunds` collection. Duplicating Stripe's
records would only create something that can drift from them.

Consequently there is no `stripe_refund_id` field: it is meaningless once an
order can have several.

### Three payment states, and why not more

```
pending ─┬─► paid   (refund state derived from refunded_cents)
         └─► expired
```

No `failed`. Hosted Checkout with cards never produces one — a declined card
simply leaves the buyer on Stripe's page with the session still `pending`.
`failed` is what you add the day you enable SEPA or Klarna, which fire
`checkout.session.async_payment_failed`. Adding it now would be a state
nothing can reach.

No `refund_failed` either, for the reason in §8.

`stripe_session_id` is **unique** because it is what both the webhook and the
confirmation page look an order up by, and uniqueness makes that lookup a
single row by construction rather than by hope.

One new key in `shared/utils/cancelReasons.ts`:

```ts
{ key: 'payment_expired', label: 'Checkout expired', sentence: '' }
```

Empty `sentence`, deliberately — that field is only read by the cancellation
email, and expiry sends no email (§5).

### Stock: one term added to the formula

Payment itself does not touch stock at all. A pending order carries
`status: 'open'`, so `heldByOpenOrders()` **already counts it**; expiry sets
`status: 'canceled'` and the give-back happens by itself. Under a
stored-counter design, holding stock through a checkout redirect would have
needed a reservation table and an expiry sweep. Here it needed nothing.

**Restocking a refunded line is the one thing that does change the formula**,
and it changes it by one subtraction:

```
available(p) = stock_initial(p) − Σ (quantity − refunded_quantity)
               over eo_order_items whose order.status ≠ 'canceled'
```

Refunding two of three bags drops that line's contribution from 3 to 1, and
the two go back on sale immediately. This is the right default for a coffee
shop, where the usual reason for a partial refund is that the item never left
the building.

The implementation cost is small but not zero, because **Directus's aggregate
API cannot express a computed subtraction.** `heldByOpenOrders()` currently
asks for `sum: 'quantity'` grouped by product. It becomes:

```ts
aggregate: { sum: ['quantity', 'refunded_quantity'] }, groupBy: ['product']
```

and subtracts the two sums per group in JS. Same single round-trip, a few more
lines.

**Verify multi-field `sum` against the live instance before relying on it.**
If Directus 11.6.1 returns something awkward for it, the fallback is a
`readItems` over the open lines with a reduce — more rows over the wire, same
result, and the call site does not change either way.

No double-release: a canceled order is excluded from the sum entirely, so its
lines contribute zero whether or not they also carry a `refunded_quantity`.
The two mechanisms cannot both give the same bag back.

`CLAUDE.md`'s stock section states the old formula and must be updated with
this one — it is the document people read before touching orders.

---

## 3. Placing an order

`server/api/orders.post.ts` keeps everything it does today — payload
validation, server-side pricing from the live catalog, `withStockLock()`,
availability check, insert order then lines, orphan cleanup on line failure.
Two changes inside the lock:

- writes `payment_status: 'pending'`
- **no longer sends the confirmation email** — that moves to the paid
  transition

Then, **after the lock is released**, it creates the Stripe Checkout Session
and PATCHes `stripe_session_id` onto the order.

**The Stripe call is deliberately outside `withStockLock()`.** That lock is a
single global async mutex serialising every checkout in the process; a network
round-trip to Stripe inside it would put Stripe's latency directly in front of
every other buyer's availability check. If the Stripe call throws, the order
and its lines are deleted — the same cleanup already used when line insertion
fails.

The cost is a window in which an order exists with a null
`stripe_session_id`. That is acceptable: such an order holds stock, is
`pending`, and will never be paid, so it needs the same expiry treatment as
any other abandoned checkout. It is swept by §5's fallback.

Session parameters:

- `mode: 'payment'`, `line_items` built from the **server-priced** lines, never
  from the client payload
- shipping as its own line item when non-zero, so the Stripe total matches
  `total_cents` exactly
- `customer_email` prefilled from the order
- `expires_at` set to 30 minutes **plus a one-minute margin** (Stripe's minimum
  is 30; default is 24h). The margin is not padding — asking for exactly
  `now + 1800` fails intermittently, because Stripe checks
  `expires_at − created` against *its own* creation timestamp: `Math.floor`
  discards up to 999 ms and network latency pushes `created` later still, so
  the delta arrives as 1799 and Stripe returns a 400. That happens after our
  order row already exists and is already holding stock. Round up and add a
  minute. Short
  expiry matters here because expiry *is* the stock release.
- `metadata: { order_id, order_number }` for dashboard traceability
- `success_url: {SITE_URL}/confirmation?session_id={CHECKOUT_SESSION_ID}`
- `cancel_url: {SITE_URL}/checkout?canceled=1`

The route returns `{ order, checkoutUrl }`. The client assigns
`window.location.href`.

---

## 4. The transitions

All three live in a new `server/utils/payments.ts` and are the **only** places
`payment_status`, `refunded_cents` or `refunded_quantity` are written.

**`markPaid(order, session)`**
Guard: if `payment_status !== 'pending'`, return immediately. Otherwise set
`payment_status: 'paid'`, `paid_at`, `stripe_payment_intent`, and fire the
confirmation email.

**`markExpired(order)`**
Guard: if `payment_status !== 'pending'`, return immediately. Otherwise set
`payment_status: 'expired'`, `status: 'canceled'`,
`cancel_reason: 'payment_expired'`. Stock releases itself. **No email.**

**`refund(order, lines, requestId)`**
`lines` is `[{ itemId, quantity }]` — the quantities to refund *now*, not the
running totals. Everything runs inside `withLock('payment:' + order.id)`, and
the order and its items are re-read **inside** the lock so two concurrent
refunds cannot both validate against stale numbers.

Guards, in order:

- `payment_status === 'paid'`, else 409. This alone makes an expired or
  pending order unrefundable, since neither was ever charged.
- for each line, `refunded_quantity + quantity <= quantity`, else 400. This is
  what caps the total — get the per-line caps right and the order total cannot
  be exceeded.
- the computed amount is `> 0`, else 400.

Then `stripe.refunds.create({ payment_intent, amount }, { idempotencyKey: requestId })`
and, on success, increment each line's `refunded_quantity`, add to
`refunded_cents`, and stamp `refunded_at`. **A throw propagates** — the caller
turns it into a 409 (§8).

Amount is always computed server-side as
`Σ unit_price_cents × quantity` over the refunded lines. The client sends
*which lines and how many*, never a euro figure — the same rule as pricing a
cart in §3, for the same reason.

**Shipping is never refunded by a line refund.** It comes back only on cancel,
which refunds everything still outstanding (§8). So refunding every line
individually leaves the shipping unrefunded and the order still `open`; that
is coherent, and the dialog nudges you toward cancelling instead.

### Idempotency, which partial refunds make harder

With full refunds the order id was a natural idempotency key. It no longer is:
**refunding €5 twice on a €20 order is legitimate**, so keying on the order
would silently swallow the second, correct refund.

So the key is a `requestId` — a UUID the admin dialog generates per submit and
sends with the request. Retrying a submit reuses it and Stripe collapses the
duplicate; a genuinely new refund gets a new one. This is Stripe's intended
usage, and it also makes an accidental double-click harmless.

Two guards, because refunds are the one operation here where doing it twice
costs real money: the mutex plus re-read stops a second refund being
*computed*, and the idempotency key stops a second one being *issued* if a
request is somehow replayed anyway.

### The mutex

`markPaid()` has two callers that can genuinely race (§5 and §6), and Directus
gives us no transaction. All three transitions therefore run under a mutex.

The only cross-request mutex in the app is `withStockLock()`, and for
`markPaid()` it has nothing to do with stock. Rather than let the name lie,
generalise it:

```ts
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T>
export const withStockLock = <T>(fn: () => Promise<T>) => withLock('stock', fn)
```

Per-key tails instead of one. Existing call sites are unchanged. Payment
transitions take `withLock('payment:' + orderId)`, so two different orders do
not serialise against each other and neither blocks checkout.

**The single-process caveat is unchanged and is not weakened by this work.**
`withLock()` is correct for one Nitro process and nothing more. Two instances
would let a webhook and a confirmation-page load both pass the `pending` guard
and send two confirmation emails.

---

## 5. The webhook

New public route `server/api/webhooks/stripe.post.ts`. Unauthenticated — the
signature *is* the authentication.

- Reads the **raw** body via `readRawBody(event)`, never `readBody`. A JSON
  parse-and-restringify changes the bytes and invalidates the signature. This
  is the standard first bug in every Stripe integration.
- Verifies with `stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET)`.
  A failure is 400 and nothing else.
- `checkout.session.completed` → look up by `stripe_session_id`, call
  `markPaid()`.
- `checkout.session.expired` → look up by `stripe_session_id`, call
  `markExpired()`.
- Any other event type → 200, ignored. Stripe sends more than you subscribe to
  and a non-200 makes it retry forever.

**Idempotency is mandatory, not defensive.** Stripe retries on any non-2xx,
can deliver duplicates, and does not guarantee ordering. The `pending` guard
inside both transitions is what makes a redelivered `completed` a no-op rather
than a second confirmation email.

An unknown `stripe_session_id` returns **200, not 404** — a 404 makes Stripe
retry an event we will never be able to handle.

### The sweep — expiry that does not depend on Stripe

A webhook is not a guarantee. Orders stranded by a failed Stripe call (§3)
have no session id, so no webhook will ever mention them; and a misconfigured
or long-dead endpoint means even normal abandoned checkouts never expire.
Either way the order stays `pending`, stays `open`, and **holds stock
forever**.

So expiry does not rely on the webhook at all. `sweepExpired()` finds every
`pending` order whose `date_created` is older than the expiry window plus a
15-minute grace, and calls `markExpired()` on each. It **writes** — this is
what actually releases the stock, not a display-time filter.

It is safe without consulting Stripe. Past `expires_at` the session is dead on
Stripe's side too, so a buyer cannot pay one out from under the sweep; the
grace period covers clock skew and webhook lag. Orders with a null session id
were never payable in the first place.

No cron job. The sweep runs at the top of `server/api/orders.post.ts`, before
the lock is taken — the one place where a stale hold actually costs somebody a
sale — and again in `/api/admin/orders`, so the dashboard never shows a
phantom. `markExpired()`'s `pending` guard makes running it twice free.

This makes the webhook a latency optimisation rather than a correctness
requirement, which is the same property §6 gives the paid path.

---

## 6. Confirmation, and the redirect race

**When Stripe redirects the buyer back, the webhook may not have arrived yet.**
The confirmation page therefore cannot trust our own database.

New `GET /api/orders/by-session?session_id=…`:

1. Look up the order by `stripe_session_id`.
2. If it is still `pending`, **retrieve the session from Stripe** and, if
   Stripe reports `payment_status: 'paid'`, call `markPaid()` — the same
   helper, the same guard, the same mutex.
3. Return only the fields `confirmation.vue` renders: order number, lines with
   expanded `product { id, slug, image }`, totals, shipping address, email.
   Not `user`, not `cancel_reason`, not `cancel_note`, not the Stripe ids.

This is Stripe's own recommended belt-and-braces pattern and it has a concrete
payoff: **the purchase flow stays correct with webhooks entirely down.** The
webhook's real job becomes catching the buyer who pays and then closes the tab
without returning.

`app/pages/confirmation.vue` stops reading `cart.lastOrder` from
sessionStorage and fetches by `session_id` instead. The sessionStorage value
would survive the round trip to Stripe, but it cannot answer the only question
the page now needs answered: *did the payment succeed?*

### Weakened, knowingly

**`session_id` becomes a capability token.** It is unguessable
(`cs_test_` + ~58 chars) and it never expires, and anyone holding it can read
that order's shipping address. This is precisely how Stripe intends success
URLs to work, and it is acceptable for a fake shop — but it is a real widening
of what an unauthenticated request can read compared to today, so it is
recorded here rather than passing silently.

The field allow-list in step 3 is the mitigation: the token exposes a delivery
address, not an account.

---

## 7. Checkout UI

`app/pages/checkout.vue` loses the fake payment step. The `payment` reactive
(`name`, `card`, `expiry`, `cvc`) and the `step` ref are both deleted, and the
page becomes a **single-step address form** ending in "Continue to payment".

**The cart must no longer clear when the order is placed.** Today it clears on
a successful POST. With a redirect in the middle, a buyer who backs out of
Stripe would return to an empty cart *and* a stranded pending order holding
their coffee. Clearing moves to `/confirmation`, after payment is confirmed.

`/checkout?canceled=1` renders a quiet notice — payment canceled, cart intact,
try again — and nothing more. The pending order is left alone to expire.

---

## 8. Admin

- The order list shows payment status alongside fulfillment status.
- **`server/api/admin/orders/[id].patch.ts` refuses `marked` on an order whose
  `payment_status !== 'paid'`** → 409. Never ship unpaid coffee.
- The existing reopen-from-`canceled` availability check is unchanged and
  already covers reopening an expired order, since that transition re-takes
  stock exactly like any other un-cancel.
- **Expired orders are hidden by default.** `/api/admin/orders` filters out
  `payment_status: 'expired'` unless `?includeExpired=1`, with a toggle in the
  dashboard. Every abandoned cart produces one of these, so leaving them in
  would bury real orders — but deleting them would throw away the one useful
  signal they carry.

### Two ways to refund

**Cancel refunds everything still outstanding.** There is no "cancel without
refunding" — a real shop does not have a state where the goods are canceled
and the money is kept, and a separate opt-in refund is a step an admin can
forget, leaving an order sitting canceled-but-paid with nothing chasing it.
The amount is `total_cents − refunded_cents`, so cancelling a partially
refunded order returns exactly the remainder, shipping included.

**A partial refund is its own action** on a new route,
`POST /api/admin/orders/[id]/refund`, taking `{ requestId, lines }`. It is not
a status change and does not belong in the status PATCH: it leaves `status`
alone, can be repeated, and the order stays open and shippable afterwards.

Both call the same `refund()` helper from §4. Cancel simply passes every
remaining line quantity plus the shipping remainder.

The PATCH handler, when the target status is `canceled` and the order is
`paid`, refunds **before** writing the status, and **outside
`withStockLock()`**. Both matter:

- **Outside the stock lock**, because a refund is a network round-trip to
  Stripe and the global stock mutex must not wait on it. Canceling never needs
  that lock anyway — it only *releases* stock, and releasing cannot oversell.
  Only the reopen path needs it, and reopen never refunds.
- **Before the status write**, because that is the ordering whose failure
  modes are both survivable. If the refund throws, **the whole PATCH is a 409
  and nothing changed** — the order is still paid and still open, and the
  admin can retry. If instead the refund succeeds and the status write then
  fails, the order sits fully refunded but still `open`: visibly wrong in the
  dashboard, and retryable. Refund-then-write has a loud bad case;
  write-then-refund has a silent one.

For that retry to actually work, **cancel treats a zero remainder as a no-op,
not an error.** `refund()` rejects a zero amount (§4), so cancel checks
`total_cents − refunded_cents` first and skips the Stripe call entirely when
there is nothing left to return. Without that, the one failure mode this
ordering is designed to survive would be unrecoverable through the UI.

**An order with `refunded_cents > 0` cannot be reopened** → 409, next to the
existing out-of-stock reopen check. Without this, un-canceling would hand you
an `open` order whose money has already gone back to the customer. It is the
one rule in this feature that is genuinely easier to design now than to
retrofit.

That guard also keeps the existing reopen availability check correct without
touching it: any order that *can* be reopened has every `refunded_quantity` at
zero, so `quantity` and `quantity − refunded_quantity` are the same number
there.

### Mail

The cancellation email gains one line — the amount refunded and that it lands
on the original payment method in 5–10 business days — shown only when
something was actually returned. Per the house rule that lives in
`server/utils/email/shell.ts`; `canceled.ts` does not change.

A **partial** refund needs a fourth template, `server/utils/email/refunded.ts`,
listing the refunded items and the amount. It is a customer-facing event none
of the existing three cover, and it must not be silent — money moving without
a mail is exactly the thing a customer writes in about. Small, because
`shell.ts` already carries the chrome and every field access.

### Dashboard

- The order list shows fully and partially refunded orders distinctly. An
  unpaid cancel and a refunded cancel are not the same event and should not
  look alike.
- The cancel confirmation states the amount that will be returned before you
  commit.
- The refund dialog lists each line with its remaining refundable quantity,
  computes the amount live, and generates the `requestId`. When a selection
  covers every remaining line it points out that cancelling would also return
  the shipping — the case where a partial refund is probably the wrong tool.

---

## 9. Environment and dependencies

`yarn add stripe`.

Three new keys in `.env` and `.env.example`:

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
SITE_URL=http://localhost:3000
```

`STRIPE_SECRET_KEY` is server-side only and must never reach
`runtimeConfig.public`. Hosted Checkout needs no publishable key at all, so
there is nothing Stripe-shaped to expose to the browser and no reason to add
a public key "for later".

`SITE_URL` exists because Stripe needs absolute success and cancel URLs.

### Two machines

Both PCs need the **Stripe CLI** installed (`winget install Stripe.StripeCli`)
and `stripe login` run once. `stripe listen --forward-to
localhost:3000/api/webhooks/stripe` prints a **different `whsec_` per machine
and per session** — it is not a shared secret and must not be committed. This
goes in the README's "Setting up on a new machine" section.

The deployed instance uses a webhook endpoint created in the Stripe dashboard,
which has its own permanent signing secret, distinct from either CLI secret.

---

## 10. Files

**New**

- `server/api/webhooks/stripe.post.ts`
- `server/api/orders/by-session.get.ts`
- `server/api/admin/orders/[id]/refund.post.ts`
- `server/utils/payments.ts` — `markPaid()`, `markExpired()`, `refund()`,
  `sweepExpired()`, session creation
- `server/utils/stripe.ts` — the configured SDK client, mirroring `directus()`
- `server/utils/email/refunded.ts` — partial-refund notification

**Changed**

- `server/api/orders.post.ts` — sweep, pending status, session creation, no
  email
- `server/api/admin/orders.get.ts` — sweep, expired filter
- `server/api/admin/orders/[id].patch.ts` — unpaid-shipping guard, refund the
  remainder on cancel, refunded-cannot-reopen guard
- `server/utils/email/shell.ts` — refund line in the cancellation mail
- `server/utils/stock.ts` — `withLock(key)` generalisation, and the
  `refunded_quantity` term in `heldByOpenOrders()`
- `app/pages/checkout.vue` — fake payment step deleted, single step
- `app/pages/confirmation.vue` — fetch by `session_id`, clear cart here
- `app/pages/admin.vue` — payment status column, expired toggle, refund amount
  in the cancel confirmation, and the per-line refund dialog
- `directus/setup.ts` — also `refunded_quantity` on `eo_order_items`
- `CLAUDE.md` — the stock formula in the "read before touching orders" section
- `app/stores/cart.ts` — `lastOrder` / `setLastOrder` no longer needed
- `shared/types/directus.ts` — `PaymentStatus`, six new `EoOrder` fields,
  `refunded_quantity` on `EoOrderItem`
- `shared/utils/cancelReasons.ts` — `payment_expired`
- `directus/setup.ts` — six new fields on `eo_orders`
- `directus/seed.ts` — backfill `payment_status: 'paid'` on the demo orders
- `nuxt.config.ts` — `runtimeConfig` entries for the new keys
- `.env.example`, `README.md`, `CLAUDE.md`

`directus/seed.ts` matters more than it looks: without the backfill the eight
demo orders read as unpaid and §8's new rule refuses to ship any of them.

---

## 11. Out of scope

- **Refunding partial quantities of shipping.** Shipping is all-or-nothing and
  comes back only on cancel. Apportioning it across lines is arithmetic
  nobody asked for.
- **Refund lifecycle events.** `refunds.create()` returning without throwing
  is treated as final. A card refund can in principle settle later or fail
  after the fact, and Stripe fires `refund.failed` for that; we ignore it.
  Handling it properly means a `refund_failed` state and a retry queue, which
  is a lot of machinery for something that does not happen with test cards.
- **Live mode.** Test keys only. Real money needs a verified business account
  and brings tax, invoicing, Impressum, AGB and Widerrufsrecht with it — all
  out of scope for a fake shop.
- SEPA, Klarna, and other async methods (they need `async_payment_succeeded` /
  `async_payment_failed` and a `failed` state).
- Saved cards and Stripe Customer objects.
- Tax calculation and invoices.
- Partial fulfillment and per-line status.

---

## 12. Verification

No test framework, by choice — verify by running things.

1. `yarn directus:setup` twice. Second run reports only "exists"/"skip".
2. `yarn directus:seed`, then confirm the eight demo orders read `paid`.
3. `stripe listen --forward-to localhost:3000/api/webhooks/stripe` in one
   terminal, `yarn dev` in another.
4. Note a product's `stock_available` on `/shop`. Start a checkout. **Confirm
   availability drops while the order is still `pending`** — this is the whole
   design in one observation.
5. Pay with `4242 4242 4242 4242`. Expect: redirect to `/confirmation`, order
   `paid`, confirmation email received, cart emptied.
6. Start another checkout and abandon it on the Stripe page. Rather than
    waiting out the 30-minute minimum, expire it deliberately:
    `stripe checkout sessions expire cs_test_...`. Expect
    `checkout.session.expired` in the CLI output, order `expired` +
    `canceled`, **stock back to its original number**, and **no email**.
7. Prove the sweep works without the webhook: stop the CLI listener, abandon
    another checkout, expire its session at Stripe, then place any order.
    Expect the stranded order to flip to `expired` and its stock to come back
    **with no webhook involved at all**.
8. Resend a `completed` event from the Stripe dashboard for an order that is
    already paid. Expect 200 and **no second email**.
9. Stop the CLI listener, complete a payment, and load `/confirmation`
    directly. Expect the order to be marked paid anyway by §6.
10. Try to mark an unpaid order as shipped in `/admin`. Expect 409.
11. Cancel a **paid** order. Expect: a refund for the full `total_cents` in
    the Stripe dashboard, `refunded_cents == total_cents`, stock returned, and
    a cancellation email carrying the refund line.
12. Try to reopen that order. Expect 409 — and confirm it is the refund guard
    talking, not the stock check, by attempting it on one whose stock is
    still free.
13. **Partial refund, the core case.** On a paid order with a line of qty 3,
    refund 2. Expect: a refund for `unit_price × 2` only, `refunded_quantity`
    of 2 on that line, order still `paid` and still `open`, the
    `refunded.ts` mail sent, and **`stock_available` on `/shop` up by exactly
    2** — not 3, and not unchanged.
14. Refund the last 1 of that line. Expect it to succeed, then a third attempt
    to fail 400 on the per-line cap.
15. Now cancel that order. Expect a further refund of **the shipping only**,
    since the lines are already returned, and `refunded_cents == total_cents`.
16. Double-submit the refund dialog. Expect exactly **one** refund in the
    Stripe dashboard — the `requestId` idempotency key doing its job.
17. Cancel an `expired` order. Expect no refund attempt at all — never paid.
18. Cancel a paid order with an invalid `STRIPE_SECRET_KEY` set. Expect 409
    and an order still `paid` and still `open` — **nothing half-applied.** Fix
    the key and retry; expect it to now succeed.
19. Confirm the aggregate change directly: with a partially refunded open
    order in the database, check that `/api/catalog` reports
    `stock_initial − (quantity − refunded_quantity)` for that product. This is
    the one query the multi-field `sum` assumption rests on.
20. Post garbage to `/api/webhooks/stripe` with no signature. Expect 400.
21. Typecheck — the only mechanical check that a field rename was missed:

    ```bash
    npx --yes -p vue-tsc@2.2.10 -p typescript@5.8.3 vue-tsc --noEmit -p .nuxt/tsconfig.json
    ```

    Exit 0 with no output is a pass. Confirm it actually ran — a crashed run
    and a clean run look identical if you only grep for errors.
