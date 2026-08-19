# Stripe Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fake card form on `/checkout` with real Stripe test-mode payments — hosted Checkout, signed webhooks, stock held through the redirect and released on abandonment, and refunds (full on cancel, or per line and quantity, with the coffee going back on sale).

**Architecture:** Orders are created `pending` *before* redirecting to Stripe, so they hold stock exactly as they do today via the derived-availability formula. Payment is confirmed by either a signed webhook or the confirmation page retrieving the session from Stripe — whichever arrives first — so the webhook is a latency optimisation, not a correctness requirement. Refund state is derived from `refunded_cents` / `refunded_quantity` rather than stored as an enum, and Stripe itself is the refund ledger.

**Tech Stack:** Nuxt 4 (Nitro server routes), `stripe` Node SDK, Directus 11.6.1 via `@directus/sdk`, Pinia, Tailwind 4. Package manager is **yarn**.

**Spec:** `docs/superpowers/specs/2026-08-19-stripe-payments-design.md`

---

## Ground rules for this plan

Two deviations from the default skill template, both from `CLAUDE.md`:

1. **No commit steps.** Robby reviews and commits himself. Never run `git commit` or `git push`. When a phase is done, say so and suggest a message.
2. **No test framework, by choice.** There is no vitest/jest here and none is being added. Every "verify" step is a real command or a real click-through, and its expected output is written out.

Three more things that will bite otherwise:

- **Editing `shared/` needs a dev-server restart.** Nuxt's auto-import watcher only watches `app/`. Tasks 2 and 16 touch `shared/` — restart `yarn dev` after them or you get `is not defined` at runtime.
- **Typecheck with `--build tsconfig.json`, never `-p .nuxt/tsconfig.json`.** This plan originally specified the latter, copied from CLAUDE.md, and it was wrong: `.nuxt/tsconfig.json` is the *app* project and does not include `../server/**/*`. It gives a false pass for every Nitro route and everything in `server/utils/` — which is most of this plan. Discovered during Task 5, where it had hidden a genuine error in `sweepExpired()`. CLAUDE.md has been corrected too.
- **Don't run `yarn build` while `yarn dev` is running.** They share `node_modules/.cache/nuxt/.nuxt` and the build kills the server.
- **Files in `server/utils/` are auto-imported** into server routes. No import statement needed for `directus()`, `stripe()`, `withLock()`, `markPaid()` etc. inside `server/api/**`. They *do* need explicit imports when used from another file in `server/utils/`.

---

## File Structure

**New files**

| File | Responsibility |
| --- | --- |
| `server/utils/stripe.ts` | The configured Stripe client and `siteUrl()`. Mirrors `directus.ts`. Nothing else. |
| `server/utils/payments.ts` | Every write to `payment_status`, `refunded_cents`, `refunded_quantity`. Session creation, `markPaid`, `markExpired`, `refund`, `sweepExpired`. |
| `server/api/webhooks/stripe.post.ts` | Signature verification and event dispatch. No business logic — it calls `payments.ts`. |
| `server/api/orders/by-session.get.ts` | The confirmation page's data source, plus the Stripe-retrieve fallback. |
| `server/api/admin/orders/[id]/refund.post.ts` | Partial refunds. Admin-gated. |
| `server/utils/email/refunded.ts` | Partial-refund notification. Thin template over `shell.ts`, like the other three. |
| `app/components/RefundDialog.vue` | Per-line refund picker. Owns only its own draft and emits `confirm`, mirroring `CancelDialog.vue`. |

**Modified files**

| File | Change |
| --- | --- |
| `directus/setup.ts` | Six fields on `eo_orders`, one on `eo_order_items` |
| `directus/seed.ts` | Demo orders seeded and backfilled as `paid` |
| `shared/types/directus.ts` | `PaymentStatus`, new `EoOrder` / `EoOrderItem` fields |
| `shared/utils/cancelReasons.ts` | `payment_expired` key |
| `server/utils/stock.ts` | `withLock(key)` generalisation; `refunded_quantity` term |
| `server/api/orders.post.ts` | Sweep, `pending`, session creation, no email |
| `server/api/admin/orders.get.ts` | Sweep, expired filter |
| `server/api/admin/orders/[id].patch.ts` | Unpaid-shipping guard, refund on cancel, reopen guard |
| `server/utils/email/shell.ts` | Refund helpers; all order field access stays here |
| `server/utils/email/canceled.ts` | Refund line, and stop claiming nothing was charged |
| `server/api/dev/preview-mail.get.ts` | `?template=refunded`, plus a refunded `canceled` variant |
| `app/pages/checkout.vue` | Single step, redirect, cancel notice |
| `app/pages/confirmation.vue` | Fetch by `session_id`, clear cart here |
| `app/pages/admin.vue` | Payment badges, refund trigger, dialog wiring |
| `app/components/CancelDialog.vue` | States the amount cancelling will refund |
| `app/stores/cart.ts` | `lastOrder` / `setLastOrder` removed |
| `.env.example`, `README.md`, `CLAUDE.md` | New keys, Stripe CLI setup, new stock formula |

**Deliberately unchanged:** `nuxt.config.ts`. The spec listed it, but `directus.ts` reads `process.env` directly rather than going through `runtimeConfig`, and `stripe.ts` follows that house pattern. There is nothing public to expose — hosted Checkout needs no publishable key.

---

# Phase 0 — Schema and configuration

## Task 1: Stripe dependency, env keys, and the client

**Files:**
- Modify: `package.json` (via yarn)
- Modify: `.env` (local, gitignored), `.env.example`
- Create: `server/utils/stripe.ts`

- [ ] **Step 1: Install the SDK**

```bash
yarn add stripe
```

Expected: `package.json` dependencies gain `"stripe": "^x.y.z"`. **Use yarn, never npm.**

- [ ] **Step 2: Get test keys**

Sign in at https://dashboard.stripe.com. Confirm the **Test mode** toggle is on. Copy the secret key (`sk_test_…`) from Developers → API keys. No business verification is needed for test mode.

- [ ] **Step 3: Install the Stripe CLI and log in**

```bash
winget install Stripe.StripeCli
stripe login
```

Expected: a browser opens to authorise the CLI, then `Done! The Stripe CLI is configured`.

This must be repeated on the second PC — see Task 18.

- [ ] **Step 4: Add the three keys to `.env.example`**

Append to `.env.example`:

```bash
# Stripe — TEST MODE ONLY. This shop never takes real money.
#
# STRIPE_SECRET_KEY is server-side only and must never reach the client.
# Hosted Checkout needs no publishable key at all: there is no Stripe JS in
# the browser, so there is nothing public to expose and no reason to add one.
#
# STRIPE_WEBHOOK_SECRET is NOT a shared value. Locally it is printed by
#   stripe listen --forward-to localhost:3000/api/webhooks/stripe
# and differs per machine AND per listen session. In production it is the
# signing secret of the endpoint created in the Stripe dashboard.
#
# SITE_URL is the absolute base Stripe redirects back to after checkout.
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
SITE_URL=http://localhost:3000
```

- [ ] **Step 5: Add the real values to `.env`**

Put the `sk_test_…` key in `STRIPE_SECRET_KEY` and `SITE_URL=http://localhost:3000`. Leave `STRIPE_WEBHOOK_SECRET` empty for now — Task 7 fills it from the CLI.

- [ ] **Step 6: Write the Stripe client util**

Create `server/utils/stripe.ts`:

```ts
import Stripe from 'stripe'

let client: Stripe | null = null

/**
 * The Stripe wire API version, pinned deliberately.
 *
 * The SDK already sends an explicit Stripe-Version header — it falls back to a
 * constant baked into the installed package. Pinning here changes nothing about
 * today's behaviour; it changes what happens on `yarn upgrade stripe`. Without
 * it, a version bump silently moves the wire protocol under us with no visible
 * diff, and nothing in this project typechecks on build to catch the fallout.
 * With it, the bump is a line someone has to write on purpose.
 *
 * Keep this equal to the SDK's own default (stripe/cjs/apiVersion.js) and move
 * both together — the SDK's types describe that version.
 */
const API_VERSION = '2026-07-29.dahlia'

/**
 * Stripe client on the secret key — server-side only, test mode.
 *
 * Built lazily and cached, exactly like directus(): env is read on first use
 * rather than at import time, so a missing key fails the request that needed
 * it instead of the whole server boot.
 */
export function stripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY missing in env')
    client = new Stripe(key, { apiVersion: API_VERSION })
  }
  return client
}

/** Absolute base for Stripe's success and cancel URLs. Stripe rejects relative ones. */
export function siteUrl(): string {
  const url = process.env.SITE_URL
  if (!url) throw new Error('SITE_URL missing in env')
  return url.replace(/\/$/, '')
}
```

- [ ] **Step 7: Verify the key works**

```bash
node --env-file=.env -e "const S=require('stripe');new S(process.env.STRIPE_SECRET_KEY).balance.retrieve().then(b=>console.log('ok, livemode:',b.livemode)).catch(e=>{console.error('FAILED:',e.message);process.exit(1)})"
```

Expected: `ok, livemode: false`

**`livemode: false` is the important half.** If it prints `true` you have a live key in `.env` and must replace it before going further.

---

## Task 2: Directus schema fields, cancel reason, and types

**Files:**
- Modify: `directus/setup.ts`
- Modify: `shared/utils/cancelReasons.ts`
- Modify: `shared/types/directus.ts`

`createCollection()` loops its field list through `ensure()`, which treats "already exists" as success. **So adding fields to an existing collection is just adding entries to the array** — a re-run reports `exists` for the old ones and `created` for the new. No separate migration path is needed.

- [ ] **Step 1: Add the six `eo_orders` fields**

In `directus/setup.ts`, inside the `createCollection('eo_orders', 'receipt_long', [...])` array, insert immediately after the existing `status` field object and before `str('customer_name', …)`:

```ts
    {
      field: 'payment_status',
      type: 'string',
      meta: {
        interface: 'select-dropdown',
        required: true,
        options: {
          choices: [
            { text: 'Pending', value: 'pending' },
            { text: 'Paid', value: 'paid' },
            { text: 'Expired', value: 'expired' },
          ],
        },
      },
      schema: { default_value: 'pending', is_nullable: false },
    },
    str('stripe_session_id', { unique: true }),
    str('stripe_payment_intent'),
    { field: 'paid_at', type: 'timestamp', meta: { interface: 'datetime' }, schema: { is_nullable: true } },
    int('refunded_cents', { required: true, min: 0, def: 0 }),
    { field: 'refunded_at', type: 'timestamp', meta: { interface: 'datetime' }, schema: { is_nullable: true } },
```

Note `paid_at` and `refunded_at` are **plain** timestamps, not the `timestamp()` helper — that helper adds `special: ['date-created'|'date-updated']`, which would make Directus stamp them itself and ignore our writes.

- [ ] **Step 2: Add the `eo_order_items` field**

In the `createCollection('eo_order_items', 'list', [...])` array, after `int('quantity', { required: true, min: 1 })`:

```ts
    int('refunded_quantity', { required: true, min: 0, def: 0 }),
```

- [ ] **Step 3: Run setup**

```bash
yarn directus:setup
```

Expected: `exists` for everything that was already there, and `created` for exactly these seven lines:

```
  created  eo_orders.payment_status
  created  eo_orders.stripe_session_id
  created  eo_orders.stripe_payment_intent
  created  eo_orders.paid_at
  created  eo_orders.refunded_cents
  created  eo_orders.refunded_at
  created  eo_order_items.refunded_quantity
```

- [ ] **Step 4: Run setup again to prove idempotency**

```bash
yarn directus:setup
```

Expected: **no `created` lines at all.** Every line reports `exists` or `skip`. This is the check that the second machine can run it safely.

- [ ] **Step 5: Add the `payment_expired` cancel reason**

`markExpired()` (Task 5) writes `cancel_reason: 'payment_expired'`, and the admin PATCH validates reasons against this list — without the key, that value has no label and `isCancelReasonKey()` rejects it.

In `shared/utils/cancelReasons.ts`, add to the `CANCEL_REASONS` array, after the `payment_problem` entry:

```ts
  {
    key: 'payment_expired',
    label: 'Checkout expired',
    sentence: '',
  },
```

Empty `sentence` deliberately: that field is only read by the cancellation email, and an expired checkout sends no mail. A sentence here would be dead text that only appears if someone later cancels an already-expired order by hand.

- [ ] **Step 6: Update the types**

In `shared/types/directus.ts`, add above `EoOrderItem`:

```ts
export type PaymentStatus = 'pending' | 'paid' | 'expired'
```

Add to `EoOrderItem`, after `quantity`:

```ts
  /** How many of `quantity` have been refunded. Comes off the held stock total. */
  refunded_quantity: number
```

Add to `EoOrder`, after `total_cents`:

```ts
  payment_status: PaymentStatus
  /** Stripe Checkout Session id. Null only in the brief window in
   *  /api/orders between inserting the order and creating the session. */
  stripe_session_id: string | null
  stripe_payment_intent: string | null
  paid_at: string | null
  /** Accumulated across every refund. Refund state is DERIVED from this
   *  against total_cents — there is no `refunded` payment_status. */
  refunded_cents: number
  refunded_at: string | null
```

- [ ] **Step 7: Restart the dev server**

Stop `yarn dev` and start it again. `shared/` changes are invisible to a running server.

- [ ] **Step 8: Verify the columns exist and defaulted correctly**

```bash
node --env-file=.env -e "fetch(process.env.DIRECTUS_URL+'/items/eo_orders?fields=order_number,payment_status,refunded_cents&limit=3',{headers:{Authorization:'Bearer '+process.env.DIRECTUS_API_TOKEN}}).then(r=>r.json()).then(d=>console.log(d.data))"
```

Expected: three rows, each with `payment_status: 'pending'` and `refunded_cents: 0`. The existing demo orders picked up the column defaults — Task 3 corrects them to `paid`.

---

## Task 3: Seed the demo orders as paid

The eight demo orders now read `pending`, which means Task 12's rule would refuse to ship any of them. `seedOrders()` skips orders that already exist, so new inserts and existing rows need handling separately.

**Files:**
- Modify: `directus/seed.ts`

- [ ] **Step 1: Mark newly created demo orders paid**

In `directus/seed.ts`, in the `api('/items/eo_orders', { method: 'POST', … })` call inside `seedOrders()`, add `payment_status` and `paid_at` to the body:

```ts
    const order = await api('/items/eo_orders', {
      method: 'POST',
      body: JSON.stringify({
        order_number, customer_name, email, street, zip, city, country, status, date_created,
        subtotal_cents: subtotal, shipping_cents: shipping, total_cents: subtotal + shipping,
        // Demo orders represent completed purchases. Without this they default
        // to 'pending' and the admin's unpaid-shipping guard refuses them.
        payment_status: 'paid',
        paid_at: date_created,
      }),
    })
```

Unlike `date_created`, neither field carries a `special`, so both are writable on create and need no PATCH repair.

- [ ] **Step 2: Backfill the orders that already exist**

Add this function to `directus/seed.ts`, immediately after `seedOrders()`:

```ts
/**
 * The demo orders predate payment_status, so they defaulted to 'pending' when
 * the column was added. seedOrders() skips rows that already exist, so it can
 * never fix them — this can. Idempotent: a repaired order is filtered out.
 */
async function backfillOrderPayments() {
  console.log('Demo order payment backfill')
  for (const o of demoOrders) {
    const rows = await api(
      `/items/eo_orders?filter[order_number][_eq]=${o.order_number}` +
      `&filter[payment_status][_neq]=paid&fields=id,date_created&limit=1`,
    )
    const row = rows?.[0]
    if (!row) { console.log(`  ok     ${o.order_number}`); continue }
    await api(`/items/eo_orders/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ payment_status: 'paid', paid_at: row.date_created }),
    })
    console.log(`  paid   ${o.order_number}`)
  }
}
```

- [ ] **Step 3: Call it**

Find where `seedOrders()` is called in `main()` and add the backfill on the line after it:

```ts
  await seedOrders()
  await backfillOrderPayments()
```

- [ ] **Step 4: Run the seed**

```bash
yarn directus:seed
```

Expected: `skip` for all eight orders (they exist), then eight `paid` lines from the backfill.

- [ ] **Step 5: Run it again**

```bash
yarn directus:seed
```

Expected: eight `skip` lines and eight **`ok`** lines — nothing patched twice.

- [ ] **Step 6: Verify**

```bash
node --env-file=.env -e "fetch(process.env.DIRECTUS_URL+'/items/eo_orders?fields=order_number,payment_status,paid_at&limit=-1',{headers:{Authorization:'Bearer '+process.env.DIRECTUS_API_TOKEN}}).then(r=>r.json()).then(d=>console.table(d.data))"
```

Expected: every row `paid`, with a non-null `paid_at` matching its creation date.

---

## Task 4: Generalise the lock and add the refund term to stock

**Files:**
- Modify: `server/utils/stock.ts`

This is the load-bearing file. Read the comments in it before editing.

- [ ] **Step 1: Replace the lock with a keyed version**

In `server/utils/stock.ts`, replace the `let tail` declaration and the whole `withStockLock` function at the bottom of the file with:

```ts
/**
 * Serialises async work per key.
 *
 * CORRECT FOR A SINGLE NITRO PROCESS, AND ONLY FOR THAT. It is not a database
 * guarantee and must not be described as one. If this app is ever run across
 * multiple instances, get MySQL credentials and add a trigger-based guard.
 *
 * Two keys are in use:
 *   'stock'            — the global checkout critical section (see below)
 *   'payment:<id>'     — one order's payment transitions (server/utils/payments.ts)
 *
 * Keying matters: a refund is a network round-trip to Stripe, and putting that
 * behind the same mutex as every checkout would serialise the whole shop
 * behind Stripe's latency.
 */
const tails = new Map<string, Promise<unknown>>()

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // Chain onto this key's tail, and make the tail immune to this call's
  // rejection — otherwise one failure would poison every later call.
  const prev = tails.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.then(() => undefined, () => undefined)
  tails.set(key, tail)
  // Drop the entry once this is the last waiter, so the map does not grow one
  // entry per order id for the lifetime of the process.
  tail.then(() => { if (tails.get(key) === tail) tails.delete(key) })
  return run
}

/**
 * The checkout critical section.
 *
 * Deriving stock removes the lost update but not the check-then-insert window:
 * two checkouts can both compute "1 available" and both insert. This closes it.
 */
export function withStockLock<T>(fn: () => Promise<T>): Promise<T> {
  return withLock('stock', fn)
}
```

Every existing `withStockLock(...)` call site keeps working unchanged.

- [ ] **Step 2: Add the refund term to the availability formula**

Replace the `heldByOpenOrders` function with:

```ts
/**
 * Availability, derived — never stored.
 *
 *   available(p) = stock_initial(p) − Σ (quantity − refunded_quantity)
 *                  over order lines whose order is not canceled
 *
 * This is why checkout is insert-only and cancellation needs no give-back:
 * a canceled order simply stops counting. There is no counter to decrement
 * and therefore no lost update to lose.
 *
 * `refunded_quantity` is the restock term: refunding two of three bags drops
 * that line's contribution from 3 to 1 and puts two straight back on sale.
 * A canceled order is excluded from the sum entirely, so an order that was
 * both refunded and canceled contributes zero either way — the two mechanisms
 * cannot both give the same bag back.
 *
 * Directus's aggregate API cannot express a computed subtraction, so both
 * fields are summed in one round-trip and subtracted per group here.
 *
 * Directus cannot create triggers or CHECK constraints, so unlike the old
 * Supabase design this is NOT a database guarantee — see withLock().
 */
export async function heldByOpenOrders(): Promise<Map<string, number>> {
  const rows = await directus().request(
    aggregate('eo_order_items', {
      aggregate: { sum: ['quantity', 'refunded_quantity'] },
      groupBy: ['product'],
      // `limit: -1` is load-bearing — see the note under this code block.
      query: { limit: -1, filter: { order: { status: { _neq: 'canceled' } } } },
    }),
  ) as unknown as Array<{
    product: string | null
    sum: { quantity: string | number | null, refunded_quantity: string | number | null }
  }>

  const held = new Map<string, number>()
  for (const r of rows) {
    if (!r.product) continue // line whose product was deleted
    const net = Number(r.sum?.quantity ?? 0) - Number(r.sum?.refunded_quantity ?? 0)
    held.set(r.product, Math.max(0, net))
  }
  return held
}
```

**Correction, verified during Task 4's review:** an earlier draft of this plan told you to add `as any` to the query object, claiming the SDK's `aggregate` types reject an array for `sum`. **That is false.** `@directus/sdk`'s `AggregateRecord` types `sum` as `Fields | Fields[]`, and `AggregationOutput` has a dedicated `extends string[]` branch producing exactly the two-key `sum` shape. The call compiles clean without any cast — proven by removing it and running the typecheck.

Do **not** add the cast. It would apply to the whole object literal, blanking `aggregate`, `groupBy` *and* `query.filter`, which is precisely where a mistyped field name would otherwise be caught — and on this project the compiler is the only thing that catches one. With the cast gone, `sum: ['quantity', 'refunded_qty']` is a compile error instead of a runtime 403.

`limit: -1` is likewise not optional. Directus caps a query at 100 rows by default and that cap applies to **group** rows, so past 100 products with open lines a product silently drops out of the map, reads back as `held = 0`, and the shop offers committed stock. The original code omitted it — a latent bug, not a deliberate difference from `availabilityFor()` directly below, which has always passed it.

- [ ] **Step 3: Verify the aggregate actually works against the live instance**

**This is the one assumption in the whole plan that rests on Directus behaviour, so prove it before building on it.**

```bash
node --env-file=.env -e "fetch(process.env.DIRECTUS_URL+'/items/eo_order_items?aggregate[sum]=quantity,refunded_quantity&groupBy=product&limit=-1',{headers:{Authorization:'Bearer '+process.env.DIRECTUS_API_TOKEN}}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d.data?.slice(0,3),null,2)))"
```

Expected: objects shaped like

```json
[{ "product": "…uuid…", "sum": { "quantity": "3", "refunded_quantity": "0" } }]
```

**If `sum` comes back with only one key, or the request errors**, use the fallback instead of fighting it — replace the body of `heldByOpenOrders()` with:

```ts
  const rows = await directus().request(readItems('eo_order_items', {
    fields: ['product', 'quantity', 'refunded_quantity'],
    filter: { order: { status: { _neq: 'canceled' } } },
    limit: -1,
  }))
  const held = new Map<string, number>()
  for (const r of rows) {
    if (!r.product) continue
    const key = r.product as string
    held.set(key, (held.get(key) ?? 0) + (r.quantity - (r.refunded_quantity ?? 0)))
  }
  return held
```

More rows over the wire, identical result, and no call site changes either way.

- [ ] **Step 4: Verify availability is unchanged**

With `yarn dev` running:

```bash
curl -s http://localhost:3000/api/catalog | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).products??JSON.parse(s);console.table((p.products??p).map(x=>({slug:x.slug,init:x.stock_initial,avail:x.stock_available})))})"
```

Expected: the same `stock_available` numbers as before this task. Every `refunded_quantity` is still 0, so the new term subtracts nothing. **If any number moved, the aggregate is wrong — stop and fix it here.**

---

# Phase 1 — Payment core

## Task 5: The payments module

**Files:**
- Create: `server/utils/payments.ts`

This file owns every write to `payment_status`, `refunded_cents` and `refunded_quantity`. Nothing else may write them.

- [ ] **Step 1: Write the module**

Create `server/utils/payments.ts`:

```ts
import { readItem, readItems, updateItem } from '@directus/sdk'
import type Stripe from 'stripe'
import type { EoOrder } from '../../shared/types/directus'
import { directus } from './directus'
import { stripe, siteUrl } from './stripe'
import { withLock } from './stock'
import { sendOrderConfirmation } from './email/confirmation'

/** Stripe's minimum session lifetime is 30 minutes. Short, because expiry IS the stock release. */
const SESSION_TTL_SECONDS = 30 * 60

/** Grace on top of the TTL before the sweep expires an order locally. Covers clock skew and webhook lag. */
const SWEEP_GRACE_SECONDS = 15 * 60

/** The expansion every mail and every order page needs. */
const FULL_FIELDS = ['*', { items: ['*', { product: ['id', 'slug', 'image'] }] }] as any

export async function readFullOrder(id: string): Promise<any> {
  return await directus().request(readItem('eo_orders', id, { fields: FULL_FIELDS }))
}

/** The one order carrying this Checkout Session, or null. */
export async function orderBySessionId(sessionId: string): Promise<any | null> {
  const rows = await directus().request(readItems('eo_orders', {
    fields: FULL_FIELDS,
    filter: { stripe_session_id: { _eq: sessionId } },
    limit: 1,
  }))
  return rows[0] ?? null
}

/**
 * Create the hosted Checkout Session for an order that is already stored.
 *
 * Called OUTSIDE the stock lock on purpose: this is a network round-trip to
 * Stripe, and holding the global checkout mutex across it would put Stripe's
 * latency in front of every other buyer's availability check.
 */
export async function createCheckoutSession(order: any): Promise<Stripe.Checkout.Session> {
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = order.items.map((l: any) => ({
    quantity: l.quantity,
    price_data: {
      currency: 'eur',
      unit_amount: l.unit_price_cents,
      product_data: { name: l.product_name },
    },
  }))

  // Shipping as its own line so the Stripe total matches total_cents exactly.
  if (order.shipping_cents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: order.shipping_cents,
        product_data: { name: 'Shipping' },
      },
    })
  }

  return await stripe().checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    customer_email: order.email,
    // Math.ceil plus a margin, NOT floor — landing exactly on Stripe's 30-minute
    // minimum fails intermittently. See SESSION_TTL_MARGIN_SECONDS.
    expires_at: Math.ceil(Date.now() / 1000) + SESSION_TTL_SECONDS + SESSION_TTL_MARGIN_SECONDS,
    metadata: { order_id: order.id, order_number: order.order_number },
    success_url: `${siteUrl()}/confirmation?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl()}/checkout?canceled=1`,
  })
}

/**
 * pending → paid. Idempotent, and it has to be: the webhook and the
 * confirmation page both call it, Stripe retries on any non-2xx, and Stripe
 * does not guarantee delivery order.
 */
export async function markPaid(orderId: string, session: Stripe.Checkout.Session): Promise<void> {
  await withLock(`payment:${orderId}`, async () => {
    const db = directus()
    // Re-read inside the lock — the other caller may have won the race.
    const current = await db.request(readItem('eo_orders', orderId, { fields: ['payment_status'] }))
    if (current.payment_status !== 'pending') return

    const intent = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null

    await db.request(updateItem('eo_orders', orderId, {
      payment_status: 'paid',
      paid_at: new Date().toISOString(),
      stripe_payment_intent: intent,
    }))

    // The confirmation mail moved here from /api/orders — an order that is
    // never paid must never be confirmed.
    const full = await readFullOrder(orderId)
    await sendOrderConfirmation(full).catch(err =>
      console.error(`[mail] confirmation for ${full.order_number} failed:`, err),
    )
  })
}

/**
 * pending → expired. Cancels the order, which is what releases the stock —
 * the derived formula does the give-back with no counter to touch.
 * Deliberately silent: an abandoned cart must not generate mail.
 */
export async function markExpired(orderId: string): Promise<void> {
  await withLock(`payment:${orderId}`, async () => {
    const db = directus()
    const current = await db.request(readItem('eo_orders', orderId, { fields: ['payment_status'] }))
    if (current.payment_status !== 'pending') return

    await db.request(updateItem('eo_orders', orderId, {
      payment_status: 'expired',
      status: 'canceled',
      cancel_reason: 'payment_expired',
      cancel_note: null,
    }))
  })
}

/**
 * Expire every pending order past its window, without asking Stripe.
 *
 * A webhook is not a guarantee: a stranded order with no session id will never
 * be mentioned by one, and a misconfigured endpoint means no abandoned order
 * ever expires. Either way the order keeps holding stock forever. This is what
 * actually makes expiry correct; the webhook only makes it fast.
 *
 * Safe without consulting Stripe. Past expires_at the session is dead on
 * Stripe's side too, so nobody can pay one out from under the sweep, and the
 * grace period covers clock skew. Orders with no session id were never payable.
 */
export async function sweepExpired(): Promise<number> {
  const cutoff = new Date(Date.now() - (SESSION_TTL_SECONDS + SWEEP_GRACE_SECONDS) * 1000).toISOString()
  const stale = await directus().request(readItems('eo_orders', {
    fields: ['id'],
    filter: { payment_status: { _eq: 'pending' }, date_created: { _lt: cutoff } },
    limit: -1,
  }))
  for (const o of stale) await markExpired(o.id)
  if (stale.length) console.log(`[sweep] expired ${stale.length} abandoned order(s)`)
  return stale.length
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx --yes -p vue-tsc@2.2.10 -p typescript@5.8.3 vue-tsc --build tsconfig.json
```

Expected: exit 0, **no output**.

**Confirm it actually ran.** A crashed run and a clean run look identical if you only check for the absence of errors — if it printed nothing at all and returned instantly, check `echo $?` (bash) or `$LASTEXITCODE` (PowerShell) and re-run `yarn dev` once first so `.nuxt/tsconfig.json` exists.

---

## Task 6: Rewire order placement

**Files:**
- Modify: `server/api/orders.post.ts`

- [ ] **Step 1: Drop the confirmation email import**

Remove this line from the top of `server/api/orders.post.ts`:

```ts
import { sendOrderConfirmation } from '../utils/email/confirmation'
```

- [ ] **Step 2: Sweep before doing anything expensive**

Immediately after `const db = directus()`, add:

```ts
  // Release stock from checkouts that were abandoned long enough ago. Runs
  // here because this is the one place a stale hold actually costs a sale.
  // markExpired()'s guard makes a redundant sweep free.
  await sweepExpired().catch(err => console.error('[sweep] failed:', err))
```

A failing sweep must not fail a checkout — it is an optimisation, not a precondition.

- [ ] **Step 3: Mark the new order pending**

In the `createItem('eo_orders', { … })` call inside `withStockLock`, add after `total_cents: total,`:

```ts
      payment_status: 'pending',
```

- [ ] **Step 4: Replace the email block with session creation**

Delete this entire block at the bottom of the handler:

```ts
  // Fire-and-forget: a mail failure must never fail an order that is already stored
  const full = { ...order, items: displayLines }
  event.waitUntil(
    sendOrderConfirmation(full as any).catch(err =>
      console.error(`[mail] confirmation for ${order.order_number} failed:`, err),
    ),
  )

  return full
```

and replace it with:

```ts
  const full = { ...order, items: displayLines }

  // Stripe is called OUTSIDE the stock lock: a network round-trip in there
  // would serialise every checkout in the app behind Stripe's latency.
  let session
  try {
    session = await createCheckoutSession(full)
  } catch (e) {
    // Same reasoning as the orphan cleanup above — a stored order that can
    // never be paid would hold stock until the sweep catches it. Delete it now.
    // CASCADE on eo_order_items.order takes the lines with it.
    await db.request(deleteItem('eo_orders', order.id)).catch(() => {})
    console.error(`[stripe] session for ${order.order_number} failed:`, e)
    throw createError({ statusCode: 502, statusMessage: 'Could not reach the payment provider. Nothing has been charged.' })
  }

  await db.request(updateItem('eo_orders', order.id, { stripe_session_id: session.id }))

  // No confirmation mail here any more — it moved to markPaid(). An order that
  // is never paid must never be confirmed.
  return { order: full, checkoutUrl: session.url }
```

- [ ] **Step 5: Add `updateItem` to the SDK import**

Change the first import line to:

```ts
import { readItems, createItem, createItems, deleteItem, updateItem } from '@directus/sdk'
```

- [ ] **Step 6: Verify by placing an order through the API**

With `yarn dev` running, and using a product id from `/api/catalog`:

```bash
curl -s -X POST http://localhost:3000/api/orders -H "Content-Type: application/json" -d '{"customer":{"firstName":"Test","lastName":"Buyer","email":"test@example.com","street":"Teststr 1","zip":"10115","city":"Berlin","country":"Germany"},"items":[{"productId":"PUT_A_REAL_PRODUCT_ID_HERE","qty":1}]}'
```

Expected: JSON containing `"checkoutUrl":"https://checkout.stripe.com/c/pay/cs_test_…"` and an `order` whose `payment_status` is `"pending"`.

- [ ] **Step 7: Verify the stock hold**

Re-run the catalog command from Task 4 Step 4.

Expected: `stock_available` for that product is **one lower than before**, while the order is still unpaid. This is the central behaviour of the whole feature — if it did not drop, stop here.

- [ ] **Step 8: Verify no confirmation mail was sent**

Check the inbox for `test@example.com`. Expected: **nothing.** The mail now waits for payment.

---

## Task 7: The webhook

**Files:**
- Create: `server/api/webhooks/stripe.post.ts`
- Modify: `.env`

- [ ] **Step 1: Start the CLI listener and capture the secret**

In its own terminal, leave this running for the rest of the project:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Expected: `> Ready! You are using Stripe API Version […]. Your webhook signing secret is whsec_…`

Copy that `whsec_…` into `STRIPE_WEBHOOK_SECRET` in `.env` and **restart `yarn dev`**.

The secret changes every time you start `stripe listen`. If signature verification starts failing for no reason, this is why.

- [ ] **Step 2: Write the route**

Create `server/api/webhooks/stripe.post.ts`:

```ts
/**
 * Stripe webhook receiver. Public and unauthenticated — the signature IS the
 * authentication, so verification is not optional.
 *
 * Local development: stripe listen --forward-to localhost:3000/api/webhooks/stripe
 */
export default defineEventHandler(async (event) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) throw createError({ statusCode: 500, statusMessage: 'STRIPE_WEBHOOK_SECRET missing' })

  const signature = getHeader(event, 'stripe-signature')
  if (!signature) throw createError({ statusCode: 400, statusMessage: 'Missing stripe-signature' })

  // MUST be the raw bytes. readBody() would parse and re-stringify the JSON,
  // changing it just enough to invalidate the signature. This is the standard
  // first bug in every Stripe integration.
  const raw = await readRawBody(event, false)
  if (!raw) throw createError({ statusCode: 400, statusMessage: 'Empty body' })

  let stripeEvent
  try {
    stripeEvent = stripe().webhooks.constructEvent(raw, signature, secret)
  } catch (e: any) {
    console.error('[stripe] signature verification failed:', e.message)
    throw createError({ statusCode: 400, statusMessage: 'Invalid signature' })
  }

  if (stripeEvent.type === 'checkout.session.completed' || stripeEvent.type === 'checkout.session.expired') {
    const session = stripeEvent.data.object as any
    const order = await orderBySessionId(session.id)

    // 200 on an unknown session, NOT 404: a 404 makes Stripe retry an event we
    // will never be able to handle, forever.
    if (!order) {
      console.warn(`[stripe] ${stripeEvent.type} for unknown session ${session.id}`)
      return { received: true }
    }

    if (stripeEvent.type === 'checkout.session.completed') await markPaid(order.id, session)
    else await markExpired(order.id)
  }

  // Everything else is acknowledged and ignored. Stripe sends more event types
  // than you subscribe to, and a non-2xx makes it retry them indefinitely.
  return { received: true }
})
```

- [ ] **Step 3: Verify signature rejection**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/webhooks/stripe -H "Content-Type: application/json" -d '{"hello":"world"}'
```

Expected: `400`

- [ ] **Step 4: Pay the order from Task 6 and watch the event land**

Open the `checkoutUrl` from Task 6 Step 6 in a browser. Pay with card `4242 4242 4242 4242`, any future expiry, any CVC, any postcode.

Expected in the `stripe listen` terminal:

```
checkout.session.completed [evt_…]   --> POST http://localhost:3000/api/webhooks/stripe [200]
```

- [ ] **Step 5: Verify the order flipped and the mail went out**

```bash
node --env-file=.env -e "fetch(process.env.DIRECTUS_URL+'/items/eo_orders?filter[email][_eq]=test@example.com&fields=order_number,payment_status,paid_at,stripe_payment_intent&sort=-date_created&limit=1',{headers:{Authorization:'Bearer '+process.env.DIRECTUS_API_TOKEN}}).then(r=>r.json()).then(d=>console.log(d.data))"
```

Expected: `payment_status: 'paid'`, a non-null `paid_at`, and a `pi_…` payment intent.

Check the inbox for `test@example.com`. Expected: **the confirmation mail, arriving now rather than at order placement.**

- [ ] **Step 6: Verify idempotency**

In the Stripe dashboard, go to Developers → Events, find that `checkout.session.completed`, and click **Resend**.

Expected: `[200]` in the CLI terminal, and **no second confirmation email**. The `pending` guard in `markPaid()` is what stops it.

---

## Task 8: The confirmation data source

**Files:**
- Create: `server/api/orders/by-session.get.ts`

- [ ] **Step 1: Write the route**

Create `server/api/orders/by-session.get.ts`:

```ts
/**
 * The confirmation page's source of truth.
 *
 * When Stripe redirects the buyer back, the webhook may not have arrived yet,
 * so this cannot simply trust our own database. If the order is still pending
 * it asks Stripe directly and applies the same transition the webhook would.
 * That is what keeps the purchase flow correct with webhooks entirely down.
 *
 * Unauthenticated by design: session_id is an unguessable capability token,
 * which is exactly how Stripe intends success URLs to work. The field
 * allow-list below is the mitigation — it exposes a delivery address, never
 * an account. Do not widen it to `...order`.
 */
export default defineEventHandler(async (event) => {
  const sessionId = getQuery(event).session_id
  if (typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid session id' })
  }

  let order = await orderBySessionId(sessionId)
  if (!order) throw createError({ statusCode: 404, statusMessage: 'Order not found' })

  if (order.payment_status === 'pending') {
    const session = await stripe().checkout.sessions.retrieve(sessionId)
    if (session.payment_status === 'paid') {
      await markPaid(order.id, session)
      order = await readFullOrder(order.id)
    }
  }

  return {
    order_number: order.order_number,
    payment_status: order.payment_status,
    customer_name: order.customer_name,
    email: order.email,
    street: order.street,
    zip: order.zip,
    city: order.city,
    country: order.country,
    subtotal_cents: order.subtotal_cents,
    shipping_cents: order.shipping_cents,
    total_cents: order.total_cents,
    items: order.items.map((i: any) => ({
      product_name: i.product_name,
      unit_price_cents: i.unit_price_cents,
      quantity: i.quantity,
      product: i.product ? { id: i.product.id, slug: i.product.slug, image: i.product.image } : null,
    })),
  }
})
```

- [ ] **Step 2: Verify with the paid session**

Use the `cs_test_…` id from Task 6 (it is in the `checkoutUrl`, and in the Stripe dashboard under Payments):

```bash
curl -s "http://localhost:3000/api/orders/by-session?session_id=cs_test_PUT_ID_HERE" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s),null,2)))"
```

Expected: the order with `payment_status: "paid"`, its items with expanded `product`, and **no `user`, `cancel_reason`, `cancel_note` or Stripe ids** in the response.

- [ ] **Step 3: Verify the webhook-independent path**

Stop the `stripe listen` terminal. Place a new order (Task 6 Step 6), pay it in the browser, then let the redirect land on `/confirmation`.

Expected: the order is `paid` in Directus and the confirmation mail arrives — **with no webhook delivered at all.** Restart `stripe listen` afterwards, and put the new `whsec_` in `.env` if it changed.

- [ ] **Step 4: Verify the bad-id cases**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/orders/by-session?session_id=nonsense"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/orders/by-session?session_id=cs_test_doesnotexist"
```

Expected: `400` then `404`.

---

# Phase 2 — Client flow

## Task 9: Checkout becomes one step

**Files:**
- Modify: `app/pages/checkout.vue`

- [ ] **Step 1: Rewrite the script block**

Replace the entire `<script setup lang="ts">` block in `app/pages/checkout.vue` with:

```ts
definePageMeta({ layout: false })

const cart = useCartStore()
const route = useRoute()
const placing = ref(false)
const placeError = ref('')
const summaryOpen = ref(false)
const img = useAssetUrl()

/** Set when Stripe bounced the buyer back via cancel_url. The pending order is
 *  left alone to expire; the cart is deliberately untouched. */
const paymentCanceled = computed(() => route.query.canceled === '1')

const form = reactive({
  firstName: '', lastName: '', email: '',
  street: '', zip: '', city: '', country: 'Germany',
})
const errors = reactive<Record<string, string>>({})

onMounted(() => {
  if (cart.items.length === 0) navigateTo('/cart')
})

function validate(): boolean {
  Object.keys(errors).forEach(k => delete errors[k])
  if (!form.firstName.trim()) errors.firstName = 'Please enter your first name.'
  if (!form.lastName.trim()) errors.lastName = 'Please enter your last name.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = 'Please enter a valid email address.'
  if (!form.street.trim()) errors.street = 'Please enter your street and number.'
  if (form.country === 'Germany' ? !/^\d{5}$/.test(form.zip.trim()) : !form.zip.trim()) {
    errors.zip = form.country === 'Germany' ? 'ZIP must be 5 digits.' : 'Please enter your ZIP code.'
  }
  if (!form.city.trim()) errors.city = 'Please enter your city.'
  return Object.keys(errors).length === 0
}

async function goToPayment() {
  if (placing.value || !validate()) return
  placing.value = true
  placeError.value = ''
  try {
    const { checkoutUrl } = await $fetch<{ checkoutUrl: string }>('/api/orders', {
      method: 'POST',
      body: {
        customer: { ...form },
        items: cart.items.map(i => ({ productId: i.productId, qty: i.qty })),
      },
    })
    // The cart is deliberately NOT cleared here. Backing out of Stripe must
    // leave it intact — /confirmation clears it once payment is confirmed.
    window.location.href = checkoutUrl
  } catch (e: any) {
    // e.data.statusMessage keeps the original text — e.statusMessage comes from the
    // HTTP reason phrase, which h3 strips of non-ASCII (every product name has an en dash)
    placeError.value = e?.data?.statusMessage ?? e?.data?.message ?? e?.statusMessage
      ?? e?.message ?? 'Something went wrong placing your order.'
    placing.value = false
  }
  // No `finally` — on success the browser is navigating away and the button
  // should stay disabled until it does.
}

const inputClass = (key: string) =>
  `h-[50px] w-full rounded-[10px] border bg-cream px-4 text-[15px] outline-none transition-colors focus:border-terra focus:border-2 focus:bg-white ${
    errors[key] ? 'border-status-canceled' : 'border-line'
  }`
```

- [ ] **Step 2: Replace the step indicator with a payment-provider note**

In the template, replace the whole `<!-- step indicator -->` block (the `<div class="relative mt-6 flex items-center justify-center gap-3">` and everything inside it) with:

```html
      <!-- payment note: hosted Checkout means we never see a card number -->
      <p class="relative mt-5 text-center text-[13px] text-[#EFE4D8]/60">
        Payment is handled by Stripe — you'll be redirected to complete it.
      </p>
```

- [ ] **Step 3: Unwrap step 1 and delete step 2**

In the form card, remove the `<template v-if="step === 1">` opening tag and its matching `</template>`, keeping the contents. Then delete the entire `<!-- ===== STEP 2 ===== -->` block from `<template v-else>` through its closing `</template>`.

- [ ] **Step 4: Rewire the submit button and add the two notices**

Change the form's submit handler:

```html
          <form class="mt-7 space-y-5" novalidate @submit.prevent="goToPayment">
```

Then replace the closing submit row:

```html
            <div class="flex justify-end pt-2">
              <button type="submit" class="btn-primary w-full md:w-auto">Continue to payment →</button>
            </div>
```

with:

```html
            <p v-if="paymentCanceled" class="rounded-[10px] bg-cream px-4 py-3 text-[13px] leading-relaxed text-muted">
              Payment was canceled — nothing has been charged and your cart is still here.
            </p>
            <p v-if="placeError" class="rounded-[10px] bg-status-canceled-bg px-4 py-3 text-[13px] text-status-canceled-text">
              {{ placeError }}
            </p>

            <div class="flex justify-end pt-2">
              <button
                type="submit"
                class="btn-primary w-full md:w-auto"
                :disabled="placing"
                :class="placing ? 'opacity-70 pointer-events-none' : ''"
              >
                {{ placing ? 'Redirecting to Stripe…' : `Continue to payment — ${fmtPrice(cart.totalCents)}` }}
              </button>
            </div>
```

- [ ] **Step 5: Remove the last `step` reference**

In the desktop summary aside, delete the whole `<div v-if="step === 2" class="mt-6 border-t border-[#EFE4D8]/18 pt-5">` block (the SHIPS TO panel). There is no step 2 to show it on.

- [ ] **Step 6: Verify no `step` or `payment` references survive**

```bash
grep -n "step\|payment\." app/pages/checkout.vue
```

Expected: no matches for `step ===`, `step.value`, `payment.name`, `payment.card`, `payment.expiry` or `payment.cvc`. (`paymentCanceled` and `goToPayment` are fine.)

- [ ] **Step 7: Click through it**

Open http://localhost:3000, add a product, go to `/checkout`, fill the form, submit.

Expected: the page is a single step with no card fields, the button reads `Continue to payment — €…`, and the browser lands on `checkout.stripe.com` showing the correct line items and total.

- [ ] **Step 8: Verify the cancel path**

On the Stripe page, click the back arrow to return to the shop.

Expected: back on `/checkout?canceled=1`, the notice reads "Payment was canceled…", and **the cart still has its items**.

---

## Task 10: Confirmation fetches by session

**Files:**
- Modify: `app/pages/confirmation.vue`
- Modify: `app/stores/cart.ts`

- [ ] **Step 1: Rewrite the confirmation script block**

Replace the entire `<script setup lang="ts">` block in `app/pages/confirmation.vue` with:

```ts
definePageMeta({ layout: false })

const cart = useCartStore()
const route = useRoute()
const batch = batchInfo()
const img = useAssetUrl()

const sessionId = computed(() => String(route.query.session_id ?? ''))

// Fetched from the server, not read out of the store: sessionStorage would
// survive the round trip to Stripe but cannot answer the only question this
// page needs answered — did the payment actually succeed?
const { data: order } = await useFetch('/api/orders/by-session', {
  query: { session_id: sessionId },
  immediate: !!sessionId.value,
})

onMounted(() => {
  if (!sessionId.value || !order.value) { navigateTo('/'); return }
  // Cleared HERE, not at checkout: backing out of Stripe must leave the cart
  // intact, so it only goes once the money is confirmed.
  if (order.value.payment_status === 'paid') cart.clear()
})

const firstName = computed(() => order.value?.customer_name?.split(' ')[0] ?? '')

useHead({ title: 'Order confirmed — Ember & Oak' })
```

- [ ] **Step 2: Fix the two template references**

The template uses `item.product?.slug` and `order.items`, which the new payload still provides, so the items block needs no change. The only edit is the total line, which is unchanged too.

Verify by searching for anything the new payload does not carry:

```bash
grep -n "order\.user\|cancel_reason\|cancel_note\|lastOrder" app/pages/confirmation.vue
```

Expected: no matches.

- [ ] **Step 3: Remove `lastOrder` from the cart store**

In `app/stores/cart.ts`:

- delete `const LAST_ORDER_KEY = 'eo-last-order'`
- delete `const lastOrder = ref<any>(null)`
- delete the second `try { … }` block in `hydrate()` (the one reading `LAST_ORDER_KEY`)
- delete the whole `setLastOrder` function
- remove `lastOrder` and `setLastOrder` from the returned object

- [ ] **Step 4: Verify nothing still calls it**

```bash
grep -rn "lastOrder\|setLastOrder\|eo-last-order" app/ server/ shared/
```

Expected: **no matches.**

- [ ] **Step 5: Full click-through**

Add a product, check out, pay with `4242 4242 4242 4242`.

Expected, in order:
1. Redirect to `/confirmation?session_id=cs_test_…`
2. The page renders the order number, items with thumbnails, and the delivery address
3. The cart badge in the header is **empty**
4. The confirmation mail arrives
5. `stripe listen` shows `checkout.session.completed … [200]`

- [ ] **Step 6: Verify the direct-hit guard**

Open http://localhost:3000/confirmation with no query string.

Expected: redirected to `/`.

---

# Phase 3 — Expiry

## Task 11: Wire the sweep into the admin list

The sweep already runs on checkout (Task 6). The dashboard needs it too so it never displays a phantom hold.

**Files:**
- Modify: `server/api/admin/orders.get.ts`

- [ ] **Step 1: Sweep and filter**

Replace the body of the handler in `server/api/admin/orders.get.ts` with:

```ts
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  // Same sweep as checkout — the dashboard must never show a phantom hold.
  // markExpired()'s guard makes a redundant run free.
  await sweepExpired().catch(err => console.error('[sweep] failed:', err))

  // Abandoned checkouts are hidden by default: every one produces a canceled
  // order, and on a busy shop they would bury the real ones. The data stays,
  // behind ?includeExpired=1.
  const includeExpired = getQuery(event).includeExpired === '1'

  // product(...) is a live relation for thumbnails and links only — name and
  // price stay snapshotted on the line. Null once the product is deleted.
  // `as any`: the SDK cannot see through EoOrderItem.product's `| null` to the
  // relation, so it rejects the nested expansion at the type level only.
  const fields = ['*', { items: ['*', { product: ['id', 'slug', 'image'] }] }] as const

  return await directus().request(readItems('eo_orders', {
    fields: fields as any,
    ...(includeExpired ? {} : { filter: { payment_status: { _neq: 'expired' } } }),
    sort: ['-date_created'],
    limit: -1,
  }))
})
```

- [ ] **Step 2: Create an order that will expire**

Place an order via curl (Task 6 Step 6) but **do not pay it**. Note the `cs_test_…` id from the `checkoutUrl` and the product's current `stock_available`.

- [ ] **Step 3: Expire it deliberately**

Waiting out the 30-minute minimum is pointless. Expire the session at Stripe:

```bash
stripe checkout sessions expire cs_test_PUT_ID_HERE
```

Expected in the `stripe listen` terminal:

```
checkout.session.expired [evt_…]   --> POST http://localhost:3000/api/webhooks/stripe [200]
```

- [ ] **Step 4: Verify the order and the stock**

```bash
node --env-file=.env -e "fetch(process.env.DIRECTUS_URL+'/items/eo_orders?filter[email][_eq]=test@example.com&fields=order_number,status,payment_status,cancel_reason&sort=-date_created&limit=1',{headers:{Authorization:'Bearer '+process.env.DIRECTUS_API_TOKEN}}).then(r=>r.json()).then(d=>console.log(d.data))"
```

Expected: `status: 'canceled'`, `payment_status: 'expired'`, `cancel_reason: 'payment_expired'`.

Then re-run the catalog check from Task 4 Step 4. Expected: `stock_available` is **back to its pre-order number**.

Check the inbox. Expected: **no email.** An abandoned cart must not generate mail.

- [ ] **Step 5: Verify the sweep works with no webhook at all**

Stop `stripe listen`. Place another unpaid order, expire its session with the CLI (the event now goes nowhere), then hit the admin list:

```bash
curl -s http://localhost:3000/api/admin/orders -H "Cookie: eo_at=PUT_YOUR_SESSION_COOKIE" -o /dev/null -w "%{http_code}\n"
```

Simpler: just open http://localhost:3000/admin in the browser while signed in as an admin.

The sweep only acts on orders older than 45 minutes, so to see it act immediately, temporarily set `SWEEP_GRACE_SECONDS = 0` and `SESSION_TTL_SECONDS = 60` in `server/utils/payments.ts`, wait a minute, reload `/admin`, and confirm the order flipped to `expired` and the stock came back **with no webhook involved**. **Restore both constants afterwards.**

- [ ] **Step 6: Verify expired orders are hidden**

Open http://localhost:3000/admin.

Expected: the expired test orders are **not** in the list. Then:

```bash
curl -s "http://localhost:3000/api/admin/orders?includeExpired=1" -b "COOKIE_JAR" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log('total',o.length,'expired',o.filter(x=>x.payment_status==='expired').length)})"
```

Expected: the expired ones appear when `includeExpired=1` is set.

---

# Phase 4 — Admin and refunds

## Task 12: Payment awareness in the admin

**Files:**
- Modify: `server/api/admin/orders/[id].patch.ts`
- Modify: `app/pages/admin.vue`

- [ ] **Step 1: Refuse to ship an unpaid order**

In `server/api/admin/orders/[id].patch.ts`, change the "read the status we are coming from" block to also read payment fields:

```ts
  // Read what we are coming from, so the mail only fires on a real transition
  const before = await db.request(readItem('eo_orders', id, {
    fields: ['status', 'payment_status', 'refunded_cents', 'total_cents', 'stripe_payment_intent'],
  })).catch(() => null)
  if (!before) throw createError({ statusCode: 404, statusMessage: 'Order not found' })

  // Never ship unpaid coffee.
  if (body.status === 'marked' && before.payment_status !== 'paid') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Cannot ship this order — it has not been paid.',
    })
  }
```

- [ ] **Step 2: Show payment state in the dashboard**

In `app/pages/admin.vue`, add these helpers to the script block, after `itemsCount`:

```ts
/** Refund state is derived from the amounts — there is no `refunded` status. */
function refundState(order: ExpandedOrder): 'none' | 'partial' | 'full' {
  if (!order.refunded_cents) return 'none'
  return order.refunded_cents >= order.total_cents ? 'full' : 'partial'
}

function paymentLabel(order: ExpandedOrder): string {
  if (order.payment_status !== 'paid') return order.payment_status
  const state = refundState(order)
  if (state === 'full') return 'refunded'
  if (state === 'partial') return `part. refunded ${fmtPrice(order.refunded_cents)}`
  return 'paid'
}

function paymentClass(order: ExpandedOrder): string {
  if (order.payment_status === 'pending') return 'border-line text-muted'
  if (order.payment_status === 'expired') return 'border-line text-muted line-through'
  const state = refundState(order)
  if (state !== 'none') return 'border-[#EAD9AE] bg-[#FBF3E1] text-[#9A7217]'
  return 'border-status-marked/40 text-status-marked-text'
}
```

- [ ] **Step 3: Render the badge in both layouts**

`admin.vue` renders orders **twice** — a desktop table (under `<!-- ===== desktop table ===== -->`) and mobile cards (under `<!-- ===== tablet/mobile cards ===== -->`). Both need the badge or it vanishes on one breakpoint.

In the **desktop table**, find the status badge cell:

```html
            <span>
              <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium" :class="[badgeStyles[order.status].bg, badgeStyles[order.status].text]">
                <span class="h-[7px] w-[7px] rounded-full" :class="badgeStyles[order.status].dot" />
                {{ badgeStyles[order.status].label }}
              </span>
            </span>
```

and add the payment badge inside that outer `<span>`, directly after the inner status badge closes:

```html
              <span
                class="mono-label ml-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold"
                :class="paymentClass(order)"
              >{{ paymentLabel(order) }}</span>
```

In the **mobile cards** block, find the equivalent `badgeStyles[order.status]` badge and add the same `<span>` immediately after it.

- [ ] **Step 3b: Show the refund total in the expanded panel**

In the `<!-- expanded -->` block, inside the `LINE ITEMS` card, add after the Shipping row's closing `</div>`:

```html
                  <div v-if="order.refunded_cents > 0" class="flex justify-between border-t border-line pt-2 text-[13px] text-[#9A7217]">
                    <span>Refunded</span>
                    <span class="font-medium">− {{ fmtPrice(order.refunded_cents) }}</span>
                  </div>
```

And show per-line refunds by changing the line-items loop to:

```html
                  <div v-for="(item, i) in order.items" :key="i" class="flex justify-between text-[13px]">
                    <span>
                      {{ item.product_name }} × {{ item.quantity }}
                      <span v-if="item.refunded_quantity" class="text-[#9A7217]">
                        ({{ item.refunded_quantity }} refunded)
                      </span>
                    </span>
                    <span class="font-medium">{{ fmtPrice(item.unit_price_cents * item.quantity) }}</span>
                  </div>
```

- [ ] **Step 4: Verify the unpaid-shipping guard**

Place an order via curl and leave it unpaid. Then, in `/admin`, try to set it to Marked.

Expected: the change is rejected, the row snaps back, and the error banner reads **"Cannot ship this order — it has not been paid."**

- [ ] **Step 5: Verify the badges**

Expected in /admin at BOTH breakpoints — resize the window to check the mobile cards too.

Expected in `/admin`: the eight demo orders show a green `paid` badge; the unpaid test order shows a muted `pending` badge.

---

## Task 13: The refund helper

**Files:**
- Modify: `server/utils/payments.ts`

- [ ] **Step 1: Add the refund function**

Append to `server/utils/payments.ts`:

```ts
export interface RefundLine {
  /** eo_order_items id */
  itemId: string
  /** How many to refund NOW — not the running total. */
  quantity: number
}

export interface RefundResult {
  amountCents: number
  refundedCents: number
  lines: Array<{ product_name: string, quantity: number, amount_cents: number }>
}

/**
 * Refund some or all of an order.
 *
 * Everything runs inside the per-order lock and the order is re-read INSIDE it,
 * so two concurrent refunds cannot both validate against stale numbers.
 *
 * `extraCents` is how cancel returns the shipping: a line refund never touches
 * it, because apportioning shipping across lines is arithmetic nobody asked for.
 *
 * Throws on any guard failure — the caller turns that into a 409/400 and
 * nothing is written, which is the whole point of refunding before the status
 * write in the PATCH handler.
 */
export async function refund(
  orderId: string,
  lines: RefundLine[],
  requestId: string,
  extraCents = 0,
): Promise<RefundResult> {
  return await withLock(`payment:${orderId}`, async () => {
    const db = directus()
    const order = await readFullOrder(orderId)

    if (order.payment_status !== 'paid') {
      throw createError({ statusCode: 409, statusMessage: 'This order has not been paid, so there is nothing to refund.' })
    }
    if (!order.stripe_payment_intent) {
      throw createError({ statusCode: 409, statusMessage: 'This order has no payment on file.' })
    }

    // Validate every line against its remaining refundable quantity BEFORE
    // calling Stripe. Get the per-line caps right and the order total cannot
    // be exceeded.
    const planned: Array<{ item: any, quantity: number, amount: number }> = []
    for (const l of lines) {
      const item = order.items.find((i: any) => i.id === l.itemId)
      if (!item) throw createError({ statusCode: 400, statusMessage: 'Unknown order line' })
      if (!Number.isInteger(l.quantity) || l.quantity < 1) {
        throw createError({ statusCode: 400, statusMessage: 'Refund quantity must be a positive whole number' })
      }
      const remaining = item.quantity - (item.refunded_quantity ?? 0)
      if (l.quantity > remaining) {
        throw createError({
          statusCode: 400,
          statusMessage: `Cannot refund ${l.quantity} × ${item.product_name} — only ${remaining} left to refund.`,
        })
      }
      planned.push({ item, quantity: l.quantity, amount: item.unit_price_cents * l.quantity })
    }

    // Amount is ALWAYS computed server-side. The client says which lines and
    // how many, never a euro figure — same rule as pricing a cart.
    const amount = planned.reduce((n, p) => n + p.amount, 0) + extraCents
    if (amount <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'Nothing to refund' })
    }
    if (order.refunded_cents + amount > order.total_cents) {
      throw createError({ statusCode: 400, statusMessage: 'That would refund more than the order total.' })
    }

    // requestId, not the order id: refunding €5 twice on a €20 order is
    // legitimate, so an order-scoped key would silently swallow the second,
    // correct refund. A retried submit reuses its id and Stripe collapses it.
    await stripe().refunds.create(
      { payment_intent: order.stripe_payment_intent, amount },
      { idempotencyKey: `refund:${orderId}:${requestId}` },
    )

    for (const p of planned) {
      await db.request(updateItem('eo_order_items', p.item.id, {
        refunded_quantity: (p.item.refunded_quantity ?? 0) + p.quantity,
      }))
    }
    await db.request(updateItem('eo_orders', orderId, {
      refunded_cents: order.refunded_cents + amount,
      refunded_at: new Date().toISOString(),
    }))

    return {
      amountCents: amount,
      refundedCents: order.refunded_cents + amount,
      lines: planned.map(p => ({
        product_name: p.item.product_name,
        quantity: p.quantity,
        amount_cents: p.amount,
      })),
    }
  })
}
```

- [ ] **Step 2: Import `createError`**

`createError` is auto-imported in server *routes* but not inside `server/utils/`. Add to the top of `server/utils/payments.ts`:

```ts
import { createError } from 'h3'
```

- [ ] **Step 3: Typecheck**

```bash
npx --yes -p vue-tsc@2.2.10 -p typescript@5.8.3 vue-tsc --build tsconfig.json
```

Expected: exit 0, no output.

---

## Task 14: The refund route

**Files:**
- Create: `server/api/admin/orders/[id]/refund.post.ts`

- [ ] **Step 1: Write the route**

Create `server/api/admin/orders/[id]/refund.post.ts`:

```ts
// The email modules under server/utils/email/ are imported explicitly in this
// codebase — see orders.post.ts and [id].patch.ts. Only top-level
// server/utils/*.ts is auto-imported, which is where refund() and
// readFullOrder() come from.
import { sendOrderRefunded } from '../../../../utils/email/refunded'

/**
 * Partial refund. Its own route, not part of the status PATCH: it is not a
 * status change, it can be repeated, and the order stays open and shippable
 * afterwards.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid order id' })
  }

  const body = await readBody<{ requestId?: string, lines?: Array<{ itemId: string, quantity: number }> }>(event)

  // The idempotency key comes from the client so a retried submit reuses it.
  if (typeof body?.requestId !== 'string' || body.requestId.length < 8 || body.requestId.length > 100) {
    throw createError({ statusCode: 400, statusMessage: 'Missing or invalid requestId' })
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No lines to refund' })
  }

  const result = await refund(id, body.lines, body.requestId)

  const order = await readFullOrder(id)
  event.waitUntil(
    sendOrderRefunded(order as any, result).catch(err =>
      console.error(`[mail] refund notice for ${order.order_number} failed:`, err),
    ),
  )

  return { order, refund: result }
})
```

- [ ] **Step 2: Note the dependency**

This route calls `sendOrderRefunded`, which Task 16 creates. **The route will not run until Task 16 is done** — that is expected. Do Task 15 and 16, then verify all three together in Task 16.

---

## Task 15: Refund on cancel, and the reopen guard

**Files:**
- Modify: `server/api/admin/orders/[id].patch.ts`

- [ ] **Step 1: Block reopening a refunded order**

Inside the `withStockLock` block, immediately before the existing `if (before.status === 'canceled' && body.status !== 'canceled')` stock check, add:

```ts
    // Un-canceling a refunded order would hand you an open order whose money
    // has already gone back to the customer.
    if (before.status === 'canceled' && body.status !== 'canceled' && before.refunded_cents > 0) {
      throw createError({
        statusCode: 409,
        statusMessage: 'This order was refunded and cannot be reopened.',
      })
    }
```

This also keeps the existing availability check below correct without touching it: any order that *can* be reopened has every `refunded_quantity` at zero, so `quantity` and `quantity − refunded_quantity` are the same number there.

- [ ] **Step 2: Refund the remainder on cancel**

Immediately **before** the `const data = await withStockLock(async () => {` line, add:

```ts
  // Canceling a paid order returns everything still outstanding, shipping
  // included. There is deliberately no "cancel without refunding".
  //
  // Outside the stock lock, because this is a network round-trip to Stripe and
  // the global checkout mutex must not wait on it. Canceling never needs that
  // lock anyway — it only releases stock, and releasing cannot oversell.
  //
  // BEFORE the status write, because that ordering's failure modes are both
  // survivable: a throw here means 409 and nothing changed. The reverse order
  // would fail silently.
  if (body.status === 'canceled' && before.status !== 'canceled' && before.payment_status === 'paid') {
    const remainder = before.total_cents - before.refunded_cents
    // A zero remainder must be a NO-OP, not an error. refund() rejects a zero
    // amount, so without this a retry after a failed status write — the exact
    // case the ordering above is designed to survive — would 400 forever.
    if (remainder > 0) {
      const full = await readFullOrder(id)
      const lines = full.items
        .filter((i: any) => i.quantity - (i.refunded_quantity ?? 0) > 0)
        .map((i: any) => ({ itemId: i.id, quantity: i.quantity - (i.refunded_quantity ?? 0) }))
      const lineTotal = full.items.reduce(
        (n: number, i: any) => n + i.unit_price_cents * (i.quantity - (i.refunded_quantity ?? 0)), 0)
      // Whatever the lines do not cover is the shipping remainder.
      await refund(id, lines, `cancel:${id}`, remainder - lineTotal)
    }
  }
```

The idempotency key is `cancel:<order id>` — deliberately stable, because cancelling the same order twice *is* the duplicate that should be collapsed.

- [ ] **Step 3: Verify the full-refund-on-cancel path**

Place an order and pay it. Note the product's `stock_available`. Then cancel the order in `/admin`, picking any reason.

Expected:
1. In the Stripe dashboard (Payments → that payment → Refunds), a refund for the **full order total including shipping**
2. `refunded_cents == total_cents` in Directus
3. `stock_available` back to its pre-order value
4. The cancellation email arrives (its refund line comes in Task 16)

- [ ] **Step 4: Verify the reopen guard**

Try to set that same canceled order back to Open in `/admin`.

Expected: rejected with **"This order was refunded and cannot be reopened."**

Confirm it is the refund guard and not the stock check: the product has stock free, so the old out-of-stock 409 cannot be what fired.

- [ ] **Step 5: Verify an expired order is never refunded**

Cancel one of the `expired` test orders (visible via `?includeExpired=1`).

Expected: no refund attempt at all, no Stripe activity, and no error — it was never `paid`, so the `before.payment_status === 'paid'` check skips the whole block.

---

## Task 16: The refund email

**Files:**
- Modify: `server/utils/email/shell.ts`
- Create: `server/utils/email/refunded.ts`
- Modify: `server/api/dev/preview-mail.get.ts`

- [ ] **Step 1: Teach the shell about refunds**

In `server/utils/email/shell.ts`, add `refunded_cents` to the `OrderEmailOrder` interface, after `total_cents`:

```ts
  refunded_cents?: number
```

Then add these two exports at the end of the file — **all order field access lives here, so the templates below reference no order fields at all**:

```ts
/** Colour for refund messaging. Between "shipped" green and "canceled" red. */
export const REFUND = '#9A7217'

/**
 * The refund sentence for the cancellation mail. Empty when nothing was
 * returned, so the caller can drop the whole block.
 */
export function refundNoticeHtml(order: OrderEmailOrder): string {
  const cents = order.refunded_cents ?? 0
  if (cents <= 0) return ''
  return `<p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:${ESPRESSO};">`
    + `We've refunded <strong>${esc(fmtPrice(cents))}</strong> to your original payment method. `
    + `It usually appears within 5–10 business days.</p>`
}

export function refundNoticeText(order: OrderEmailOrder): string {
  const cents = order.refunded_cents ?? 0
  if (cents <= 0) return ''
  return `We've refunded ${fmtPrice(cents)} to your original payment method. `
    + `It usually appears within 5-10 business days.`
}

/** The lines covered by one refund, for the partial-refund mail. */
export function refundedLinesHtml(lines: Array<{ product_name: string, quantity: number, amount_cents: number }>): string {
  return lines.map(l =>
    `<p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:${ESPRESSO};">`
    + `${esc(l.product_name)} × ${l.quantity} — ${esc(fmtPrice(l.amount_cents))}</p>`,
  ).join('\n          ')
}

export function refundedLinesText(lines: Array<{ product_name: string, quantity: number, amount_cents: number }>): string {
  return lines.map(l => `  ${l.product_name} x ${l.quantity} — ${fmtPrice(l.amount_cents)}`).join('\n')
}
```

- [ ] **Step 2: Add the notice to the cancellation mail**

In `server/utils/email/canceled.ts`, add `refundNoticeHtml` and `refundNoticeText` to the existing import list from `./shell`.

Then in `reasonParts`, leave it alone, and change the two lead strings — a refunded order was definitely charged, so "Nothing has been charged" would be a lie. Replace the `lead` const:

```ts
  const refundedHtml = refundNoticeHtml(order)
  const refundedText = refundNoticeText(order)
  const chargeLine = refundedText
    ? ''
    : 'Nothing has been charged. '
  const lead = `Order ${esc(order.order_number)} has been canceled. ${chargeLine}If this is unexpected, just reply to this mail and we'll sort it out.`
```

Add the refund sentence into the reason card by changing the `reasonHtml` array so it is always present when there is a refund. Replace the `const { sentence, note, show } = reasonParts(order)` line and the `reasonHtml` block with:

```ts
  const { sentence, note } = reasonParts(order)
  const show = Boolean(sentence || note || refundedHtml)

  const reasonHtml = show
    ? [`<!-- why -->
        ${oneColSection('WHY', [
          sentence
            ? `<p style="margin:0;font-size:14px;line-height:1.6;color:${ESPRESSO};">${esc(sentence)}</p>`
            : '',
          note
            ? `<p style="margin:${sentence ? '10px' : '0'} 0 0;font-size:14px;line-height:1.6;color:${MUTED};">${esc(note)}</p>`
            : '',
          refundedHtml,
        ].filter(Boolean).join('\n          '))}`]
    : []
```

and the text version:

```ts
  const reasonText = show
    ? [`WHY\n${[sentence, note, refundedText].filter(Boolean).map(line => `  ${line}`).join('\n')}`]
    : []
```

Finally change the plain-text lead to match:

```ts
    lead: `Order ${order.order_number} has been canceled. ${chargeLine}If this is unexpected, just reply to this mail and we'll sort it out.`,
```

- [ ] **Step 3: Write the partial-refund template**

Create `server/utils/email/refunded.ts`:

```ts
import { sendMail } from '../mailer'
import { fmtPrice } from '../../../shared/utils/shop'
import {
  REFUND,
  esc,
  itemLinesText,
  itemsSection,
  oneColSection,
  refundedLinesHtml,
  refundedLinesText,
  renderShell,
  renderShellText,
  totalsText,
  type OrderEmailOrder,
} from './shell'

export interface RefundSummary {
  amountCents: number
  lines: Array<{ product_name: string, quantity: number, amount_cents: number }>
}

export function buildOrderRefunded(order: OrderEmailOrder, refund: RefundSummary) {
  const subject = `A refund for order ${order.order_number} is on its way — Ember & Oak`

  const heading = 'We’ve refunded part of your order'
  const leadPlain = `We've refunded ${fmtPrice(refund.amountCents)} for order ${order.order_number}. `
    + `It usually appears on your original payment method within 5-10 business days. `
    + `The rest of your order is unaffected.`

  const html = renderShell({
    accent: REFUND,
    heading,
    lead: esc(leadPlain),
    orderNumber: order.order_number,
    sections: [
      `<!-- refunded -->
        ${oneColSection('REFUNDED', refundedLinesHtml(refund.lines))}`,
      `<!-- items -->
        ${itemsSection(order, { totals: 'total-only' })}`,
    ],
  })

  const text = renderShellText({
    heading,
    lead: leadPlain,
    orderNumber: order.order_number,
    blocks: [
      `REFUNDED\n${refundedLinesText(refund.lines)}`,
      `YOUR ITEMS\n${itemLinesText(order)}`,
      totalsText(order, { totals: 'total-only' }),
    ],
  })

  return { subject, html, text }
}

/** Async so a synchronous mailer throw becomes a rejection the caller can .catch(). */
export async function sendOrderRefunded(order: OrderEmailOrder, refund: RefundSummary) {
  const { subject, html, text } = buildOrderRefunded(order, refund)
  return sendMail({ to: order.email, subject, html, text })
}
```

- [ ] **Step 4: Add it to the dev previewer**

In `server/api/dev/preview-mail.get.ts`, add the import:

```ts
import { buildOrderRefunded } from '../../utils/email/refunded'
```

Add this case to the `switch`, between `shipped` and `canceled`:

```ts
    case 'refunded':
      html = buildOrderRefunded(
        { ...SAMPLE, refunded_cents: 1650 },
        {
          amountCents: 1650,
          lines: [{
            product_name: 'Sunrise Single Origin – Ethiopia 250g',
            quantity: 1,
            amount_cents: 1650,
          }],
        },
      ).html
      break
```

And update the doc comment above the handler:

```ts
 * ?template=confirmation (default) | shipped | canceled | refunded
```

The `canceled` case also gains a refunded variant, so both branches of the cancellation mail can be previewed. Change its `reason === 'none'` object to:

```ts
        reason === 'none'
          ? { ...SAMPLE, cancel_reason: null, cancel_note: null }
          : {
              ...SAMPLE,
              cancel_reason: 'out_of_stock',
              cancel_note: 'The Ethiopia lot sold out faster than we expected — sorry!',
              // Preview the paid-and-refunded wording, which must NOT claim
              // that nothing was charged.
              refunded_cents: SAMPLE.total_cents,
            },
```

- [ ] **Step 5: Preview all four templates**

Open each in a browser:

- http://localhost:3000/api/dev/preview-mail?template=confirmation
- http://localhost:3000/api/dev/preview-mail?template=shipped
- http://localhost:3000/api/dev/preview-mail?template=canceled
- http://localhost:3000/api/dev/preview-mail?template=refunded

Expected: all four render with the Ember & Oak chrome, and the refund one shows a REFUNDED card listing the line and amount.

- [ ] **Step 6: Verify the cancellation mail's two variants**

Cancel an **unpaid** order, then a **paid** one.

Expected: the unpaid one's mail says "Nothing has been charged"; the paid one's says "We've refunded €… to your original payment method" and **does not** claim nothing was charged.

- [ ] **Step 7: Verify the refund route end to end**

With a paid order that has a line of quantity 3 (place one via curl with `"qty":3`), get its order id and the line's item id:

```bash
node --env-file=.env -e "fetch(process.env.DIRECTUS_URL+'/items/eo_orders?filter[email][_eq]=test@example.com&fields=id,order_number,total_cents,refunded_cents,items.id,items.product_name,items.quantity,items.refunded_quantity&sort=-date_created&limit=1',{headers:{Authorization:'Bearer '+process.env.DIRECTUS_API_TOKEN}}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d.data,null,2)))"
```

Then, signed in as an admin in the browser, run this from the browser console on `/admin`:

```js
await $fetch('/api/admin/orders/ORDER_ID/refund', {
  method: 'POST',
  body: { requestId: crypto.randomUUID(), lines: [{ itemId: 'ITEM_ID', quantity: 2 }] },
})
```

Expected:
1. A refund in the Stripe dashboard for **`unit_price × 2` only** — not the order total
2. `refunded_quantity: 2` on that line, order still `paid` and still `open`
3. The `refunded` mail arrives
4. **`stock_available` up by exactly 2** — not 3, and not unchanged

- [ ] **Step 8: Verify the per-line cap**

Refund the last 1, then attempt a third.

Expected: the second call succeeds; the third fails **400** with "only 0 left to refund".

- [ ] **Step 9: Verify cancel returns only the shipping**

Now cancel that order in `/admin`.

Expected: a **further** refund in Stripe for the **shipping amount only**, since every line is already returned, and `refunded_cents == total_cents` afterwards.

---

## Task 17: The refund dialog

The cancellation dialog is a **component** — `app/components/CancelDialog.vue`, used as `<CancelDialog v-if="cancelTarget" :order="cancelTarget" @close @confirm />`. The refund dialog follows the same pattern rather than being inlined into a 400-line page: it owns its own draft state, emits `confirm`, and touches no order.

**Files:**
- Create: `app/components/RefundDialog.vue`
- Modify: `app/components/CancelDialog.vue`
- Modify: `app/pages/admin.vue`

- [ ] **Step 1: Write the dialog component**

Create `app/components/RefundDialog.vue`:

```vue
<script setup lang="ts">
import type { ExpandedOrder, ExpandedOrderItem } from '~/composables/useShop'

const props = defineProps<{ order: ExpandedOrder; busy?: boolean; error?: string | null }>()

const emit = defineEmits<{
  confirm: [lines: Array<{ itemId: string; quantity: number }>]
  close: []
}>()

// The dialog owns nothing but its own draft — the order is never mutated here.
const qty = reactive<Record<string, number>>({})
for (const i of props.order.items) qty[i.id] = 0

function remaining(item: ExpandedOrderItem): number {
  return item.quantity - (item.refunded_quantity ?? 0)
}

/** Clamp on input so the confirm button can never propose an over-refund. */
function clamp(item: ExpandedOrderItem) {
  const max = remaining(item)
  const v = Math.floor(Number(qty[item.id]) || 0)
  qty[item.id] = Math.min(Math.max(v, 0), max)
}

const amount = computed(() =>
  props.order.items.reduce((n, i) => n + i.unit_price_cents * (qty[i.id] ?? 0), 0))

/** True when the selection covers every line still refundable. */
const coversEverything = computed(() =>
  amount.value > 0 && props.order.items.every(i => (qty[i.id] ?? 0) >= remaining(i)))

const shortNo = computed(() => {
  const n = props.order.order_number
  return '#' + (n.split('-').pop() ?? n)
})

function confirm() {
  if (amount.value <= 0 || props.busy) return
  emit('confirm', props.order.items
    .filter(i => (qty[i.id] ?? 0) > 0)
    .map(i => ({ itemId: i.id, quantity: qty[i.id]! })))
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

const panel = ref<HTMLElement | null>(null)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.body.style.overflow = 'hidden'
  panel.value?.focus()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog" appear>
      <div class="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-5">
        <!-- backdrop -->
        <div class="absolute inset-0 bg-espresso/40" @click="emit('close')" />

        <!-- panel -->
        <div
          ref="panel"
          tabindex="-1"
          role="dialog"
          aria-modal="true"
          aria-labelledby="refund-dialog-title"
          class="dialog-panel card relative max-h-full w-full sm:max-w-[520px] overflow-y-auto rounded-b-none sm:rounded-b-card p-6 outline-none"
          style="box-shadow: 0 26px 56px rgba(46, 33, 26, .28)"
        >
          <h2 id="refund-dialog-title" class="font-display text-[22px] font-semibold leading-snug">
            Refund items from {{ shortNo }}
          </h2>
          <p class="mt-1.5 text-[13px] leading-relaxed text-muted">
            {{ order.customer_name }} gets an email about this. Refunded items go
            straight back on sale — shipping is only returned when you cancel the
            whole order.
          </p>

          <div class="mt-5 divide-y divide-line">
            <div v-for="item in order.items" :key="item.id" class="flex items-center gap-4 py-3">
              <div class="grow">
                <p class="text-sm font-medium">{{ item.product_name }}</p>
                <p class="mt-0.5 text-[12px] text-muted">
                  {{ fmtPrice(item.unit_price_cents) }} each ·
                  {{ remaining(item) }} of {{ item.quantity }} still refundable
                </p>
              </div>
              <input
                v-model.number="qty[item.id]"
                type="number"
                min="0"
                :max="remaining(item)"
                :disabled="remaining(item) === 0 || busy"
                class="h-[42px] w-[72px] shrink-0 rounded-[10px] border border-line bg-cream px-3 text-center text-[15px] outline-none transition-colors focus:border-terra disabled:opacity-40"
                @input="clamp(item)"
              >
            </div>
          </div>

          <p
            v-if="coversEverything"
            class="mt-4 rounded-[10px] bg-cream px-4 py-3 text-[13px] leading-relaxed text-muted"
          >
            That's every remaining item. Cancelling the order instead would also
            return the {{ fmtPrice(order.shipping_cents) }} shipping.
          </p>

          <p
            v-if="error"
            class="mt-4 rounded-[10px] bg-status-canceled-bg px-4 py-3 text-[13px] text-status-canceled-text"
          >
            {{ error }}
          </p>

          <div class="mt-6 flex items-center justify-between gap-4">
            <button
              type="button"
              class="text-sm font-medium text-muted transition-colors hover:text-espresso"
              @click="emit('close')"
            >
              Never mind
            </button>
            <button
              type="button"
              class="inline-flex h-11 items-center justify-center rounded-full bg-terra px-6 text-sm font-semibold text-white transition-colors hover:bg-terra-dark disabled:opacity-50"
              :disabled="busy || amount <= 0"
              @click="confirm"
            >
              {{ busy ? 'Refunding…' : `Refund ${fmtPrice(amount)}` }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* entry only — the parent drops the component with v-if, so there is no leave phase */
.dialog-enter-active { transition: opacity 0.2s ease-out; }
.dialog-enter-active .dialog-panel { transition: transform 0.2s ease-out; }
.dialog-enter-from { opacity: 0; }
.dialog-enter-from .dialog-panel { transform: translateY(12px); }

@media (prefers-reduced-motion: reduce) {
  .dialog-enter-active .dialog-panel { transition: none; }
  .dialog-enter-from .dialog-panel { transform: none; }
}
</style>
```

- [ ] **Step 2: Wire it into the admin page**

In the script block of `app/pages/admin.vue`, after the `cancelTarget` declaration and its helpers, add:

```ts
// ---- refund dialog ----
// shallowRef: the entry already is the reactive order object from `orders`
const refundTarget = shallowRef<ExpandedOrder | null>(null)
const refunding = ref(false)
const refundError = ref<string | null>(null)

function openRefund(order: ExpandedOrder) {
  refundError.value = null
  refundTarget.value = order
}

async function confirmRefund(lines: Array<{ itemId: string; quantity: number }>) {
  const order = refundTarget.value
  if (!order || refunding.value) return
  refunding.value = true
  refundError.value = null
  try {
    await $fetch(`/api/admin/orders/${order.id}/refund`, {
      method: 'POST',
      body: {
        // Per-submit id, not per-order: refunding €5 twice on a €20 order is
        // legitimate, so an order-scoped key would swallow the second, correct
        // refund. A retry of THIS submit reuses the id and Stripe collapses it.
        requestId: crypto.randomUUID(),
        lines,
      },
    })
    refundTarget.value = null
    // Refetch rather than mutate: refunded_quantity, refunded_cents and the
    // derived badge all move at once, and the server is the authority on all three.
    await refresh()
  } catch (e: any) {
    // e.data.statusMessage keeps the original text — e.statusMessage is the HTTP
    // reason phrase, which h3 strips of non-ASCII
    refundError.value = e?.data?.statusMessage ?? e?.data?.message
      ?? 'Could not process the refund.'
  } finally {
    refunding.value = false
  }
}
```

- [ ] **Step 3: Mount the dialog**

In `app/pages/admin.vue`, next to the existing `<CancelDialog …/>` at the end of the template, add:

```html
    <RefundDialog
      v-if="refundTarget"
      :order="refundTarget"
      :busy="refunding"
      :error="refundError"
      @close="refundTarget = null"
      @confirm="confirmRefund"
    />
```

- [ ] **Step 4: Add the trigger button**

In the `<!-- expanded -->` block of the desktop table, below the two info cards, add:

```html
            <div v-if="order.payment_status === 'paid' && order.refunded_cents < order.total_cents && order.status !== 'canceled'" class="mt-4">
              <button
                type="button"
                class="text-sm font-medium text-terra transition-colors hover:text-terra-dark"
                @click.stop="openRefund(order)"
              >
                Refund items…
              </button>
            </div>
```

Add the same block to the expanded area of the tablet/mobile card layout.

`@click.stop` matters — the row itself toggles `expandedId`, so without it the panel would collapse as the dialog opens.

- [ ] **Step 5: State the refund amount on the cancel dialog**

`CancelDialog.vue` currently takes `order: Pick<EoOrder, 'order_number' | 'customer_name'>`. Widen the prop:

```ts
const props = defineProps<{
  order: Pick<EoOrder, 'order_number' | 'customer_name' | 'payment_status' | 'total_cents' | 'refunded_cents'>
}>()
```

Add the computed:

```ts
/** What cancelling will return. Zero for an unpaid or already-refunded order. */
const refundOnCancel = computed(() =>
  props.order.payment_status === 'paid'
    ? Math.max(0, props.order.total_cents - props.order.refunded_cents)
    : 0)
```

And in the template, immediately above the button row:

```html
          <p
            v-if="refundOnCancel > 0"
            class="mt-4 rounded-[10px] bg-cream px-4 py-3 text-[13px] leading-relaxed text-muted"
          >
            {{ fmtPrice(refundOnCancel) }} will be refunded to the customer's original
            payment method, shipping included.
          </p>
```

Also soften the existing copy, which currently implies nothing was charged — check the dialog's body text and make sure it does not contradict this line.

- [ ] **Step 6: Click through a partial refund**

Place and pay an order with a line of quantity 3. In `/admin`, expand it, click **Refund items…**, set that line to 2, and confirm.

Expected:
1. The button reads `Refund €…` with the correct doubled amount *before* you click
2. The dialog closes, and the row badge becomes `part. refunded €…`
3. A refund for exactly that amount in the Stripe dashboard
4. `stock_available` on `/shop` **up by exactly 2** — not 3, not unchanged
5. The refund email arrives

- [ ] **Step 7: Verify the input clamp**

Type `99` into a line whose remaining quantity is 1.

Expected: the field snaps to `1` on input, and the button never offers to refund more than the line allows. The server rejects it anyway — this is just so the admin never sees a 400 they could not have predicted.

- [ ] **Step 8: Verify the double-click guard**

Reopen the dialog, set a quantity, and click confirm twice as fast as you can.

Expected: **exactly one** refund in the Stripe dashboard. `busy` disables the button on the first click; the `requestId` covers anything that slips past.

- [ ] **Step 9: Verify the all-lines hint**

Set every line to its full remaining quantity.

Expected: the note appears — "That's every remaining item. Cancelling the order instead would also return the €… shipping."

- [ ] **Step 10: Verify the button is hidden when it should be**

Expected: **Refund items…** does not appear on a `pending` order, an `expired` one, a `canceled` one, or one already fully refunded.

- [ ] **Step 11: Verify the cancel dialog's amount line**

Open the cancel dialog on a paid order, then on an unpaid one.

Expected: the paid one states the amount that will be refunded; the unpaid one shows no such line and does not claim a refund is coming.

- [ ] **Step 12: Verify escape and backdrop close**

Expected: `Esc` and a click on the backdrop both close the refund dialog, and `document.body` regains its scroll on unmount — the same behaviour `CancelDialog.vue` already has.

---
---

# Phase 5 — Documentation

## Task 18: Update the three docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Verify: `.env.example`

- [ ] **Step 1: Fix the stock formula in `CLAUDE.md`**

In the "Stock — read before touching orders" section, replace the formula block with:

```
available(p) = stock_initial(p) − Σ (quantity − refunded_quantity)
               over eo_order_items whose order.status ≠ 'canceled'
```

and add underneath it:

```markdown
`refunded_quantity` is the restock term: refunding two of three bags drops that
line's contribution from 3 to 1 and puts two straight back on sale. A canceled
order is excluded from the sum entirely, so an order that was both refunded and
canceled contributes zero either way — the two mechanisms cannot both give the
same bag back.

Directus's aggregate API cannot express a computed subtraction, so
`heldByOpenOrders()` sums both fields in one round-trip and subtracts per group
in JS.
```

- [ ] **Step 2: Rename the lock section in `CLAUDE.md`**

`withStockLock()` is now a wrapper over `withLock(key, fn)`. Update the paragraph that describes it, and add:

```markdown
`withLock(key, fn)` in `server/utils/stock.ts` serialises async work per key.
Two keys are in use: `'stock'` for the checkout critical section (via
`withStockLock()`), and `'payment:<order id>'` for one order's payment
transitions. Keying matters — a refund is a network round-trip to Stripe, and
putting that behind the checkout mutex would serialise the whole shop behind
Stripe's latency. It is still correct for a single Nitro process and nothing
more.
```

- [ ] **Step 3: Add a payments section to `CLAUDE.md`**

Add after the stock section:

```markdown
## Payments — Stripe, test mode only

Hosted Checkout. The buyer is redirected to `checkout.stripe.com` and comes
back to `/confirmation?session_id=…`. **There is no Stripe JS in the browser
and no publishable key** — nothing Stripe-shaped is exposed to the client.

- `server/utils/payments.ts` owns **every** write to `payment_status`,
  `refunded_cents` and `refunded_quantity`. Nothing else may write them.
- **The order is created `pending` before the redirect and holds stock**, so an
  abandoned checkout must be expired or the coffee is held forever.
- **Expiry does not depend on the webhook.** `sweepExpired()` expires any
  `pending` order past its window, and runs on checkout and on the admin list.
  The webhook only makes expiry fast. Same for payment: `/api/orders/by-session`
  retrieves the session from Stripe when the order is still pending, so the
  flow is correct with webhooks entirely down.
- **The webhook must read the raw body** (`readRawBody(event, false)`).
  `readBody` reparses the JSON and invalidates the signature. It returns 200
  for unknown sessions and unknown event types — a non-2xx makes Stripe retry
  forever.
- **Refund state is derived** from `refunded_cents` against `total_cents`.
  There is no `refunded` payment status and there is no refund history table:
  **Stripe is the ledger.**
- Refund idempotency keys are **per submit**, not per order — refunding €5
  twice on a €20 order is legitimate. Cancel is the exception and uses a stable
  `cancel:<id>` key, because cancelling twice *is* a duplicate.
- Cancelling a paid order refunds the remainder including shipping, **before**
  writing the status and **outside** the stock lock. A zero remainder is a
  no-op, not an error — otherwise a retry after a failed status write could
  never succeed.
- **A refunded order cannot be reopened.**
- `STRIPE_WEBHOOK_SECRET` is not a shared value: `stripe listen` prints a
  different one per machine and per session.
```

- [ ] **Step 4: Add Stripe to the README's new-machine section**

In "Setting up on a new machine", add:

```markdown
4. Install the Stripe CLI and authorise it:

   ```bash
   winget install Stripe.StripeCli
   stripe login
   ```

5. Put a **test-mode** secret key (`sk_test_…`) in `STRIPE_SECRET_KEY` and
   `SITE_URL=http://localhost:3000` in `.env`.

6. Start the webhook forwarder in its own terminal and copy the `whsec_…` it
   prints into `STRIPE_WEBHOOK_SECRET`, then restart `yarn dev`:

   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```

   **The secret changes every time you start `stripe listen`.** If signature
   verification suddenly starts failing, that is why. It also differs between
   the two PCs, which is why it is not committed anywhere.
```

- [ ] **Step 5: Add a testing section to the README**

```markdown
### Testing payments

Test card `4242 4242 4242 4242`, any future expiry, any CVC, any postcode.

Expiring a checkout without waiting out the 30-minute minimum:

```bash
stripe checkout sessions expire cs_test_…
```

Refunds appear under Payments → the payment → Refunds in the Stripe dashboard.
Everything is test mode; no real money moves.
```

- [ ] **Step 6: Final typecheck**

```bash
npx --yes -p vue-tsc@2.2.10 -p typescript@5.8.3 vue-tsc --build tsconfig.json
```

Expected: exit 0, no output. **Confirm it actually ran** — check the exit code, since a crashed run and a clean run look identical.

- [ ] **Step 7: Full regression pass**

Work through §12 of the spec end to end. In particular re-verify the three that are easy to break late:

1. `stock_available` drops while an order is still `pending`
2. A partial refund of 2 of 3 raises `stock_available` by exactly 2
3. Resending a `checkout.session.completed` sends **no** second confirmation email

- [ ] **Step 8: Report, do not commit**

Summarise what changed, what was verified and what was not, and **suggest** a commit message. Do not run `git commit` — Robby commits himself.

---

## Appendix: what to hand back

When every task is done, the working tree should contain seven new files and eighteen modified ones, and none of it committed. Suggested message:

```
Add Stripe test-mode payments with refunds

Hosted Checkout with signed webhooks. Orders are created pending and
hold stock through the redirect; expiry releases it via the derived
formula and does not depend on the webhook arriving. Refund state is
derived from refunded_cents, with refunded_quantity feeding back into
availability so refunded coffee goes back on sale.
```
