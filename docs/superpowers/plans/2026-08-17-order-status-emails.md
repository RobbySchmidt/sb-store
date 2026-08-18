# Order Status Emails + Cancellation Reason — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email the customer when an order is marked shipped or canceled, with an optional preset cancellation reason stored on the order and shown in the mail.

**Architecture:** `PATCH /api/admin/orders/:id` reads the order's current status, updates it, and — only when the status actually changed — fires the matching mail fire-and-forget. The three templates (confirmation, shipped, canceled) share one layout module so they stay a visual family.

**Tech Stack:** Nuxt 4 / Nitro, Vue 3, Tailwind 4, nodemailer, Mailpit, hosted Supabase, yarn.

**Spec:** `docs/superpowers/specs/2026-08-17-order-status-emails-design.md`

---

## ⛔ DO NOT COMMIT

**The repo owner commits his own work.** Do not run `git commit`, `git add` or
`git push` in any task. Leave every change in the working tree and report what
you changed. This overrides the commit habits of the planning skills.

---

**Conventions:**
- Package manager is **yarn**, never npm.
- Branch is `development`; never switch branches.
- `shared/utils/*` is auto-imported into both app and server. Server files import
  from it with an explicit relative path (`../../shared/utils/…`), matching
  `server/api/orders.post.ts`.
- Server routes get `server/utils/*` via Nitro auto-import, but templates under
  `server/utils/email/` are imported **explicitly** so nothing depends on scan depth.
- Never print secret values from `.env`; read them into shell variables when needed.
- Subagents cannot use a browser — verify with `curl` against the dev server and
  the Mailpit API (`http://localhost:8025/api/v1/messages`).
- Mailpit must be running: `docker ps --filter name=sb-store-mail`, else `docker compose up -d`.
- To start the dev server, run `yarn dev` in the background and **poll actively**
  until it answers; never sleep waiting for a notification. Kill it when done.

---

### Task 1: Cancellation reason presets and types

**Files:**
- Create: `supabase/migration-003-cancel-reason.sql`
- Create: `shared/utils/cancelReasons.ts`
- Modify: `app/types/shop.ts` (the `Order` interface)

- [ ] **Step 1: Record the migration**

The columns are **already applied** in Supabase by hand. This file exists so the
repo records the schema history — do not try to run it.

```sql
-- ============================================================
-- Migration 003 — optional cancellation reason on orders
-- Run once in the Supabase SQL editor (already applied).
-- ============================================================

alter table public.orders add column if not exists cancel_reason text;
alter table public.orders add column if not exists cancel_note   text;
```

- [ ] **Step 2: Create the presets**

```ts
export interface CancelReason {
  /** stored in orders.cancel_reason */
  key: string
  /** shown in the admin dashboard */
  label: string
  /** shown to the customer in the cancellation email; empty for 'other' */
  sentence: string
}

export const CANCEL_REASONS: readonly CancelReason[] = [
  {
    key: 'out_of_stock',
    label: 'Out of stock',
    sentence: 'The coffee in your order sold out before we could roast this batch.',
  },
  {
    key: 'customer_request',
    label: 'Customer requested',
    sentence: 'You asked us to cancel this order.',
  },
  {
    key: 'payment_problem',
    label: 'Payment problem',
    sentence: 'We could not process the payment for this order.',
  },
  {
    key: 'address_problem',
    label: 'Address problem',
    sentence: 'We could not ship to the address on the order.',
  },
  {
    key: 'other',
    label: 'Other',
    sentence: '',
  },
]

export function findCancelReason(key?: string | null): CancelReason | undefined {
  return CANCEL_REASONS.find(r => r.key === key)
}

export function isCancelReasonKey(value: unknown): boolean {
  return typeof value === 'string' && CANCEL_REASONS.some(r => r.key === value)
}
```

- [ ] **Step 3: Extend the `Order` type**

In `app/types/shop.ts`, add two fields to the `Order` interface, after
`total_cents` and before `created_at`:

```ts
  cancel_reason: string | null
  cancel_note: string | null
```

- [ ] **Step 4: Verify**

Run `yarn build`. Expected: exit 0. Nothing consumes the new module yet, so this
only proves it parses and the type change breaks nothing.

Report the files you changed. **Do not commit.**

---

### Task 2: Extract the shared email shell

A pure refactor of the working confirmation mail. Its rendered output must not
change.

**Files:**
- Create: `server/utils/email/shell.ts`
- Create: `server/utils/email/confirmation.ts`
- Delete: `server/utils/orderEmail.ts`
- Modify: `server/api/orders.post.ts` (import path only)
- Modify: `server/api/dev/preview-mail.get.ts` (import path only)

- [ ] **Step 1: Capture the current output first — this is your baseline**

Start Mailpit and the dev server, then:

```bash
curl -s http://localhost:3000/api/dev/preview-mail > /tmp/mail-before.html
wc -c /tmp/mail-before.html
```

Do not skip this. Without the baseline you cannot prove the refactor was safe.

- [ ] **Step 2: Write `server/utils/email/shell.ts`**

Move these out of `server/utils/orderEmail.ts` unchanged: the `OrderEmailItem`
and `OrderEmailOrder` interfaces, the palette constants, `FONT`, and `esc()`.
Add `cancel_reason?: string | null` and `cancel_note?: string | null` as optional
fields on `OrderEmailOrder`, and add two colour constants:

```ts
export const MARKED = '#5C8A5C'
export const CANCELED = '#B0483B'
```

Then add these building blocks, factored out of the existing confirmation
markup so it can be reproduced exactly:

- `renderShell(opts: { accent: string, heading: string, lead: string, orderNumber: string, sections: string[] }): string`
  — the `<!doctype>`, `<body>`, outer table, espresso header band with the
  wordmark, the greeting card (heading + lead + `ORDER № …` in `accent`), then
  `sections` joined, then the demo-shop footer card. The existing confirmation
  markup IS this function with `accent = TERRA`.
- `itemsSection(order, opts?: { totals?: 'full' | 'total-only' }): string`
  — the white card with one row per item and the totals rows. `'full'`
  (default) renders Subtotal / Shipping / Total exactly as today; `'total-only'`
  renders just the bold Total row.
- `twoColSection(left: { label: string, html: string }, right: { label: string, html: string }): string`
  — the two-column card used today for DELIVERS TO / ESTIMATED DELIVERY.
- `oneColSection(label: string, html: string): string`
  — a single-column labelled card, used for the cancellation reason.
- `addressHtml(order): string` — the escaped name / street / zip city, country lines.

Text-part helpers, factored out the same way:

- `renderShellText(opts: { heading: string, lead: string, orderNumber: string, blocks: string[] }): string`
- `itemLinesText(order): string`
- `totalsText(order, opts?): string`
- `addressText(order): string`

Keep every escaping call exactly where it is today: `product_name`,
`customer_name`, `street`, `zip`, `city`, `country`, `order_number` and the
derived first name all pass through `esc()` in the HTML part.

- [ ] **Step 3: Write `server/utils/email/confirmation.ts`**

Contains `buildOrderConfirmation(order)` and `async sendOrderConfirmation(order)`,
composed from the shell: accent `TERRA`, heading `Thank you{, firstName}!`, the
existing lead, `itemsSection(order)` with full totals, and `twoColSection` with
DELIVERS TO / ESTIMATED DELIVERY. Subject stays exactly
`` `Order ${order.order_number} confirmed — Ember & Oak` ``.

`sendOrderConfirmation` must be `async` (a sync throw from the mailer has to
become a rejection — this was a real bug once).

- [ ] **Step 4: Delete `server/utils/orderEmail.ts` and fix the two importers**

- `server/api/orders.post.ts` — it currently has no import for
  `sendOrderConfirmation` (Nitro auto-import). Add an explicit one:
  `import { sendOrderConfirmation } from '../utils/email/confirmation'`
- `server/api/dev/preview-mail.get.ts` — the types live in `shell.ts` and the
  builders in their own files, so it becomes two imports:
  `import { buildOrderConfirmation } from '../../utils/email/confirmation'` and
  `import type { OrderEmailOrder } from '../../utils/email/shell'`.

- [ ] **Step 5: Verify the output is unchanged — the whole point of this task**

Restart the dev server, then:

```bash
curl -s http://localhost:3000/api/dev/preview-mail > /tmp/mail-after.html
diff /tmp/mail-before.html /tmp/mail-after.html && echo "IDENTICAL"
```

Expected: `IDENTICAL`. If it differs, inspect the diff: whitespace-only
differences are acceptable (report them explicitly, showing the diff); any
difference in text, colour, style attribute or structure is a defect you must
fix before reporting done.

- [ ] **Step 6: Verify a real send still works**

`yarn build` must exit 0. Then POST a real order and confirm the confirmation
mail still arrives in Mailpit with the right subject and totals. Get product IDs
with the anon key:

```bash
curl -s "$SUPABASE_URL/rest/v1/products?select=id&limit=2" -H "apikey: $SUPABASE_KEY"
```

POST to `http://localhost:3000/api/orders` with
`{"customer":{"firstName":…,"lastName":…,"email":"shell-refactor@example.test","street":…,"zip":…,"city":…,"country":…},"items":[{"productId":"<ID>","qty":1}]}`.

Afterwards delete the test order with the service-role key filtered exactly on
that email, and clear the Mailpit inbox.

Report the diff result. **Do not commit.**

---

### Task 3: The shipped and canceled templates

**Files:**
- Create: `server/utils/email/shipped.ts`
- Create: `server/utils/email/canceled.ts`
- Modify: `server/api/dev/preview-mail.get.ts` (add `?template=`)

- [ ] **Step 1: `shipped.ts`**

Exports `buildOrderShipped(order)` and `async sendOrderShipped(order)`.

- accent: `MARKED`
- subject: `` `Order ${order.order_number} is on its way — Ember & Oak` ``
- heading: `` `Your coffee is on its way${firstName ? `, ${firstName}` : ''}!` ``
- lead: roasted in the batch, packed and handed over, with the delivery estimate
  from `batchInfo()` — e.g. `` `Roasted, packed and handed over. Estimated delivery ${batch.deliveryHuman}.` ``
- sections: `itemsSection(order, { totals: 'total-only' })`, then
  `twoColSection` with DELIVERS TO (`addressHtml(order)`) and ESTIMATED DELIVERY
  (`batch.deliveryHuman`)
- a matching plain-text part

- [ ] **Step 2: `canceled.ts`**

Exports `buildOrderCanceled(order)` and `async sendOrderCanceled(order)`.

- accent: `CANCELED`
- subject: `` `Order ${order.order_number} has been canceled — Ember & Oak` ``
- heading: `Your order has been canceled`
- lead: names the order number, states nothing has been charged, invites a reply
- reason block: **only when `findCancelReason(order.cancel_reason)` returns a
  preset or a note exists** — a `oneColSection('WHY', …)` containing the preset
  `sentence` (omit when empty, as it is for `other`) and, when
  `order.cancel_note` is non-empty, the note underneath. Both `esc()`d.
  When there is no reason and no note, the section must not be rendered at all.
- then `itemsSection(order, { totals: 'total-only' })`
- a matching plain-text part, with the reason block omitted the same way

Import `findCancelReason` from `../../../shared/utils/cancelReasons` (verify the
relative depth from `server/utils/email/` yourself).

- [ ] **Step 3: Preview all three**

Rewrite `server/api/dev/preview-mail.get.ts` to keep its dev-only 404 guard and
its `content-type: text/html; charset=utf-8`, and to select a template from
`?template=`, defaulting to `confirmation`:

- `confirmation` → the existing sample, unchanged
- `shipped` → the same sample order
- `canceled` → the same sample plus `cancel_reason: 'out_of_stock'` and
  `cancel_note: 'The Ethiopia lot sold out faster than we expected — sorry!'`

An unknown `template` value returns a 400.

Additionally support `&reason=none` on the `canceled` template, which renders the
same sample with `cancel_reason` and `cancel_note` both `null`. This makes the
no-reason path directly previewable instead of only reasoned about.

- [ ] **Step 4: Verify**

With the dev server up:

```bash
for t in confirmation shipped canceled; do
  echo "--- $t ---"
  curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/dev/preview-mail?template=$t"
done
curl -s -o /dev/null -w "unknown -> %{http_code}\n" "http://localhost:3000/api/dev/preview-mail?template=nope"
```

Expected: `200`, `200`, `200`, and `400` for the unknown one.

Then grep each rendering and report the actual matches:
- shipped contains `on its way`, the delivery estimate, all four product names, the address
- canceled contains `has been canceled`, `sold out before we could roast this batch`, the note text, and the total
- `?template=canceled&reason=none` returns 200 and contains **neither** the
  preset sentence nor the note nor the `WHY` label — grep for each and report the
  zero matches

`yarn build` must exit 0. Report results. **Do not commit.**

---

### Task 4: Send on status change

**Files:**
- Modify: `server/api/admin/orders/[id].patch.ts`

- [ ] **Step 1: Rewrite the handler**

Keep the existing id and status validation. Add:

1. Accept `{ status, reason?, note? }` from the body. Validate `reason` with
   `isCancelReasonKey` when it is present and non-null — an unknown key is a
   `400 Invalid cancel reason`. `note` is an optional string; trim it and treat
   empty as null. Cap it at 500 characters (`400` if longer).
2. Read the current row **before** updating:
   `const { data: before } = await db.from('orders').select('status').eq('id', id).single()`
   — a missing row is a `404 Order not found`.
3. Build the update: `{ status }` plus, when `status === 'canceled'`,
   `cancel_reason: reason ?? null` and `cancel_note: note ?? null`; for any other
   status, `cancel_reason: null` and `cancel_note: null`.
4. Update and `.select('*, order_items(*)').single()` as today.
5. **Only when `before.status !== status`**, fire the matching mail
   fire-and-forget, using the exact pattern from `server/api/orders.post.ts`:

```ts
  if (before.status !== body.status) {
    const send = body.status === 'marked' ? sendOrderShipped
      : body.status === 'canceled' ? sendOrderCanceled
      : null
    if (send) {
      event.waitUntil(
        send(data).catch(err =>
          console.error(`[mail] ${body.status} notice for ${data.order_number} failed:`, err),
        ),
      )
    }
  }
```

Import both senders explicitly from `../../../utils/email/shipped` and
`../../../utils/email/canceled` (verify the depth from
`server/api/admin/orders/` yourself), and `isCancelReasonKey` from the shared
module.

6. Return `data` as before — the response shape must not change, since
   `app/pages/admin.vue` consumes it.

- [ ] **Step 2: Verify every path with curl**

Dev server up, Mailpit up and its inbox cleared. Read `SUPABASE_URL` /
`SUPABASE_SECRET_KEY` into shell variables without printing them, and pick a
real order id from `"$SUPABASE_URL/rest/v1/orders?select=id,status&limit=5"`.
**Use one of the eight seeded demo orders and note its original status so you can
put it back.**

Test and report the actual result of each:

1. `PATCH {"status":"marked"}` on an `open` order → 200, and a shipping mail in
   Mailpit with the right subject.
2. `PATCH {"status":"marked"}` again → 200, and **no second mail** (Mailpit count
   unchanged).
3. `PATCH {"status":"canceled","reason":"out_of_stock","note":"test note"}` →
   200, a cancellation mail containing the preset sentence and the note, and both
   columns populated in the database (re-query the row).
4. `PATCH {"status":"open"}` → 200, **no mail**, and `cancel_reason` /
   `cancel_note` both back to `null`.
5. `PATCH {"status":"canceled","reason":"bogus_key"}` → **400**.
6. `PATCH {"status":"nonsense"}` → **400** (existing behaviour still works).
7. With `docker compose stop mailpit`: `PATCH {"status":"marked"}` → still
   **200**, one `[mail] … failed:` line in the dev log. Then
   `docker compose start mailpit`.

- [ ] **Step 3: Restore state**

Put the order you used back to its original status via a final PATCH, confirm
`cancel_reason`/`cancel_note` are null, and clear the Mailpit inbox.

Report every result. **Do not commit.**

---

### Task 5: Cancellation dialog in the admin

**Files:**
- Create: `app/components/CancelDialog.vue`
- Modify: `app/pages/admin.vue`

- [ ] **Step 1: Build the dialog**

`app/components/CancelDialog.vue`, following the existing visual language of the
admin page (cards, `rounded-full` buttons, `border-line`, terra accents; look at
`app/pages/admin.vue` and `app/assets/css/main.css` before writing any markup):

- Props: `order: Order`
- Emits: `confirm` with `{ reason: string | null, note: string | null }`, and `close`
- A fixed overlay (`bg-espresso/40`) centring a white card, max width ~460px
- Title naming the order, e.g. `Cancel order #0842?`
- The five `CANCEL_REASONS` as selectable pills — clicking the selected one
  deselects it, so "no reason" stays reachable
- A note textarea, always available, labelled optional, max 500 characters
- Buttons: `Back` (emits `close`) and `Cancel order` (emits `confirm`), the
  latter styled with the canceled red
- Closes on overlay click and on Escape

- [ ] **Step 2: Wire it into `app/pages/admin.vue`**

- `setStatus(order, status, extra?: { reason: string | null, note: string | null })`
  sends `reason` and `note` in the PATCH body when provided, and optimistically
  sets `order.cancel_reason` / `order.cancel_note` alongside `order.status`
  (clearing both for non-cancel transitions, mirroring the server).
- Clicking a `canceled` button no longer calls `setStatus` directly — it opens
  the dialog for that order. Confirming calls
  `setStatus(order, 'canceled', payload)`; Back leaves the order untouched.
  This applies to **both** the desktop table and the mobile card list.
- The expanded order row gains a `CANCELED BECAUSE` block, rendered only when
  the order is canceled and has a reason or a note: the preset label from
  `findCancelReason`, and the note underneath when present. Add it to the
  desktop expanded row and the mobile expanded block.

- [ ] **Step 3: Verify what you can without a browser**

`yarn build` must exit 0, and the admin page must still server-render:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/admin
curl -s http://localhost:3000/admin | grep -c 'SET STATUS'
```

Expected: `200` and a count of at least 1. Also confirm the dev server log shows
no Vue warnings or hydration errors while loading `/admin`.

Interactive behaviour — opening the dialog, selecting a reason, confirming,
Escape, overlay click — **cannot** be verified without a browser. State clearly
in your report that these need a human check, and list exactly what to click.

Report what you changed. **Do not commit.**

---

## Done when

- All three templates render at `/api/dev/preview-mail?template=…`, and the
  confirmation output is unchanged from before the refactor.
- A status change to `marked` or `canceled` sends exactly one matching mail;
  re-clicking the same status sends none; moving back to `open` sends none and
  clears the reason columns.
- A mail failure never fails the status change.
- The working tree holds every change, uncommitted, for the repo owner to review.
