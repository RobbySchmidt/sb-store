# Product Stock — Design

**Date:** 2026-08-17
**Status:** Approved, ready for implementation

## Goal

Track how many units of each product are available, decrement on order, give
stock back when an order is canceled, and show the amount on the product card —
including a clear out-of-stock state at zero.

## Non-goals

- No stock editing in the admin dashboard; numbers are adjusted in the Supabase
  table editor.
- No reservation holds — stock is taken at checkout, not while an item sits in a
  cart.
- No back-in-stock notifications and no low-stock alert email.
- No restock when an order row is deleted (the app never deletes orders except
  the existing rollback, which happens before any stock is taken).
- No test framework.

## The invariant

**Stock is held while an order is not canceled.** Everything below follows from
that one sentence: creating an order's lines takes stock, canceling gives it
back, un-canceling takes it again.

## Schema — `supabase/migration-004-stock.sql`

```sql
alter table public.products add column if not exists stock int not null default 0;
alter table public.products add constraint products_stock_non_negative check (stock >= 0);
```

The check constraint is the real guard: whatever races occur, Postgres refuses to
let stock go negative.

**Seed (one-time, not safe to re-run):** a spread across the twelve products so
the normal, low and out-of-stock cards are all visible immediately —
`dark-cacao-bar-70` at 0, `glass-carafe-brewer` at 2 and `wildflower-honey` at 3,
the rest between 7 and 40.

The seed then subtracts the quantities of every **existing non-canceled order**,
so the eight seeded demo orders do not violate the invariant from day one. Without
this, canceling a pre-existing demo order would hand back stock that was never
taken.

## Stock movement — two triggers

**Take on insert.** An `after insert` trigger on `order_items` decrements
`products.stock` by the row's quantity. `supabase-js` sends all lines of an order
as one statement, so it is one transaction: every line decrements or none does. A
line that would push a product below zero aborts the whole insert via the check
constraint, and the existing rollback in `server/api/orders.post.ts` deletes the
orphaned order row.

**Sync on status change.** An `after update of status` trigger on `orders` keys off
the *transition*, not the value:

- non-canceled → `canceled` → give the items back
- `canceled` → non-canceled → take them again

Keying on the transition is what makes it idempotent: re-clicking Cancel on an
already-canceled order changes nothing, because no transition occurred.

Both run under the service role, which bypasses RLS, so no policy on `products`
is needed for the update.

**New failure mode:** un-canceling an order can now fail if the stock has since
been sold. The constraint raises, the PATCH returns an error, and the admin row
snaps back. This is correct behaviour but is new for a button that previously
could not fail.

## Server

`server/api/orders.post.ts` already fetches the catalog to price the cart. It adds
`stock` to that select and checks each line **before** inserting, so the ordinary
case returns a readable 400 naming the product and the amount available rather
than a raw constraint violation. The constraint remains the backstop for a genuine
race: a Postgres check violation (SQLSTATE `23514`) is caught and returned as a
409 meaning "someone just bought the last one".

`server/api/admin/orders/[id].patch.ts` catches the same violation when a
re-deduction fails on un-cancel and returns a readable 409.

## Front end

`Product` in `app/types/shop.ts` gains `stock: number`; the catalog query already
selects `*`, so nothing else changes. `LOW_STOCK_THRESHOLD = 5` joins the other
shared constants in `shared/utils/shop.ts`.

Three states on `app/components/ProductCard.vue`:

| stock | card |
| --- | --- |
| above threshold | quiet `18 LEFT` in muted mono type, beside the price |
| 1 – 5 | `ONLY 3 LEFT` in the amber `status-open` colour |
| 0 | `OUT OF STOCK` badge on the image; add button disabled and dimmed |

Out-of-stock products stay listed and clickable — hiding them would make the shop
look emptier than it is. `app/pages/products/[slug].vue` shows the same states and
caps its quantity stepper at the available amount.

The cart is unchanged: it holds a price snapshot and knows nothing about stock. If
an item sells out while it sits in the cart, checkout fails with the readable
message from the server, shown by the existing `placeError` handling.

## Verification

1. Place an order → each product's stock drops by exactly the ordered quantity.
2. Cancel that order in the admin → stock returns to its previous value.
3. Re-click Cancel → stock unchanged (idempotence).
4. Set it back to Open → stock is taken again.
5. Order more than available → 400 naming the product and the amount left.
6. Order the last unit → stock lands at exactly 0 and the card flips to
   `OUT OF STOCK`.
7. **Race test:** fire two concurrent checkouts for the last remaining unit. One
   succeeds, one returns a clean 409, and stock is exactly 0 — never −1. This is
   the reason for the constraint-and-trigger design, so it is proven rather than
   assumed.
8. Un-cancel an order whose stock has since sold out → readable 409, and the row
   stays canceled.
