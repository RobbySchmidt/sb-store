# Order Status Emails + Cancellation Reason — Design

**Date:** 2026-08-17
**Status:** Approved, ready for implementation
**Builds on:** `2026-08-17-order-confirmation-email-design.md`

## Goal

The admin dashboard can move an order to `marked` (roasted and shipped) or
`canceled`, but the customer is never told. Both transitions should send an
email, in the same family as the existing order confirmation. Cancellations can
optionally carry a reason, chosen from a preset list with an optional free-text
note, which is stored on the order and shown to the customer.

## Non-goals

- No email when an order is moved back to `open` — that is the shop owner
  correcting a mistake, not a customer event.
- No resend action, no record of which mails were sent.
- No tracking numbers in the shipping mail (there is no carrier integration).
- No emails for status changes made directly in the Supabase dashboard — only
  changes through `PATCH /api/admin/orders/:id`.
- No test framework.

## Data

`supabase/migration-003-cancel-reason.sql` (**already applied by hand in the
Supabase SQL editor**; the file exists so the repo records the schema history):

```sql
alter table public.orders add column if not exists cancel_reason text;
alter table public.orders add column if not exists cancel_note   text;
```

`cancel_reason` holds a preset **key**, not prose, so the admin badge, the email
sentence and any future filtering all derive from one structured value.
`cancel_note` holds the optional free text. Both are cleared whenever an order
moves to a status other than `canceled`, so a stale reason cannot linger.

`Order` in `app/types/shop.ts` gains `cancel_reason: string | null` and
`cancel_note: string | null`.

## Presets

`shared/utils/cancelReasons.ts` — auto-imported into both the app and the server,
the same pattern as `shared/utils/shop.ts`. Each preset carries an admin-facing
label and a customer-facing sentence:

| key | label (admin) | sentence (email) |
| --- | --- | --- |
| `out_of_stock` | Out of stock | The coffee in your order sold out before we could roast this batch. |
| `customer_request` | Customer requested | You asked us to cancel this order. |
| `payment_problem` | Payment problem | We couldn't process the payment for this order. |
| `address_problem` | Address problem | We couldn't ship to the address on the order. |
| `other` | Other | *(empty — the note stands alone)* |

Exports: `CANCEL_REASONS`, the `CancelReasonKey` type, `findCancelReason(key)`
and `isCancelReasonKey(value)` for server-side validation.

The reason is **optional**. Confirming the dialog with nothing selected cancels
the order and sends a mail with no reason paragraph.

## Email

The three templates share one layout. `server/utils/orderEmail.ts` is split into:

```
server/utils/email/
  shell.ts          palette, esc(), the 600px table skeleton, header band,
                    footer, and the reusable item-table / totals / address /
                    note blocks — for both the HTML and the text part
  confirmation.ts   moved from orderEmail.ts, output unchanged
  shipped.ts        new
  canceled.ts       new
```

`server/utils/mailer.ts` is unchanged. Routes import templates explicitly rather
than relying on how deep Nitro's auto-import scans.

**Shipped** — accent `#5C8A5C` (the marked green). "Your coffee is on its way,
{first name}!", lead noting the batch is roasted, packed and handed over with
the delivery estimate from `batchInfo()`, the order number, item lines, total,
and the delivery address.

**Canceled** — accent `#B0483B` (the canceled red). "Your order has been
canceled", lead naming the order number and stating nothing has been charged and
inviting a reply, then a reason block when a reason is present (the preset
sentence, plus the note underneath when there is one), then item lines and total.
No reason block at all when no reason was given.

Both keep the espresso header band, the wordmark and the demo-shop footer so the
three mails read as one family.

`server/api/dev/preview-mail.get.ts` gains `?template=confirmation|shipped|canceled`,
defaulting to `confirmation`. The canceled sample includes a reason and a note.

**Refactor safety:** the confirmation mail's rendered output must stay
equivalent. Capture `/api/dev/preview-mail` before the refactor, diff after —
whitespace-only differences are acceptable, any content or style difference is a
defect.

## Admin UI

`app/components/CancelDialog.vue` — a modal opened by the **Cancel** button in
both the desktop table and the mobile cards. Contains the five presets as
one-click options (single select, deselectable), an optional note textarea, and
Confirm / Back. Confirming calls the existing `setStatus` path with the reason
and note; Back closes without changing anything.

The expanded order row gains a `CANCELED BECAUSE` block showing the preset label
and the note, rendered only for canceled orders that have a reason.

## API

`PATCH /api/admin/orders/:id` accepts `{ status, reason?, note? }`:

- validates `status` against the existing list, and `reason` with
  `isCancelReasonKey` when present — an unknown reason is a 400
- writes `cancel_reason` / `cancel_note` only for a transition to `canceled`,
  and writes `null` to both for any other status
- reads the order's current status **before** updating, and sends mail only when
  the status actually changed, so re-clicking the status an order already has
  sends nothing
- sends the shipping mail for `marked` and the cancellation mail for `canceled`,
  fire-and-forget with `event.waitUntil(...).catch(...)` exactly as
  `server/api/orders.post.ts` does. `sendOrderShipped` / `sendOrderCanceled` are
  `async` so a synchronous throw cannot escape the `.catch` (the bug found in
  the confirmation feature's final review)

## Error handling

A mail failure never fails the status change: the admin sees the badge update
and the terminal logs one `[mail] … failed:` line. A mail is never sent twice
for the same transition because the route compares against the previous status.

## Verification

Manual, no automated tests:

1. `/api/dev/preview-mail?template=…` renders all three, and the confirmation
   diff against the pre-refactor capture is whitespace-only.
2. `PATCH` an order to `marked` → shipping mail in Mailpit; to `canceled` with a
   reason → cancellation mail showing the sentence and note, and both columns
   populated in the database.
3. `PATCH` the same status twice → exactly one mail.
4. `PATCH` back to `open` → no mail, and both columns cleared.
5. In the browser: the Cancel button opens the dialog, Back cancels cleanly,
   Confirm updates the row without a refresh, and the expanded row shows the
   reason.
6. With Mailpit stopped, a status change still succeeds and logs one error.
