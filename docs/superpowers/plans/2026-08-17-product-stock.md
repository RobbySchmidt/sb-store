# Product Stock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show how many units of each product remain, decrement on order, restock on cancellation, and give the product card a clear out-of-stock state.

**Architecture:** The database owns correctness — `products.stock` carries `check (stock >= 0)`, an `after insert` trigger on `order_items` takes stock, and an `after update of status` trigger on `orders` gives it back on cancel and takes it again on un-cancel. The server adds a pre-check purely so the ordinary case produces a readable message instead of a constraint violation.

**Tech Stack:** Nuxt 4 / Nitro, Vue 3, Tailwind 4, hosted Supabase, yarn.

**Spec:** `docs/superpowers/specs/2026-08-17-product-stock-design.md`

---

## ⛔ DO NOT COMMIT

**The repo owner commits his own work.** Do not run `git commit`, `git add`, `git push`,
`git checkout`, `git restore` or `git stash` in any task. Leave every change in the
working tree and report what you changed. There are unrelated uncommitted changes in the
tree already — leave them alone.

## ⚠️ Do not kill processes you did not start

The owner may have his own `yarn dev` running. If port 3000 is busy, run yours on an
explicit free port (`yarn dev --port 3005`). Kill only your own dev server.

## ✅ The migration is already applied

`supabase/migration-004-stock.sql` has been run against the live database. The column,
the constraint, the three functions and the two triggers all exist and are verified.
**Do not re-run it** — its seed section would reset every product's stock.

Current stock (after the seed reconciled against existing demo orders):
`dark-cacao-bar-70` 0 · `glass-carafe-brewer` 2 · `wildflower-honey` 2 ·
`ceramic-pour-over-dripper` 5 · `sunrise-single-origin-ethiopia` 5 ·
`oat-milk-syrup-vanilla` 8 · `ember-blend-dark-roast` 10 ·
`midnight-decaf-swiss-water` 12 · `ember-oak-ceramic-mug` 15 ·
`house-espresso-classic` 23 · `honey-almond-granola` 28 · `paper-filters-02` 38

**If a task changes stock while testing, restore the value afterwards.**

**Conventions:** yarn not npm · branch `development` · never print secrets from `.env` ·
`shared/utils/*` is auto-imported into app and server · subagents have no browser, so
verify with `curl` · Mailpit should stay running (`docker compose up -d`).

---

### Task 1: Shared stock helpers and the type

**Files:**
- Modify: `shared/utils/shop.ts`
- Modify: `app/types/shop.ts`

- [ ] **Step 1: Add the helpers**

Append to `shared/utils/shop.ts`, next to the existing constants:

```ts
export const LOW_STOCK_THRESHOLD = 5

export type StockTone = 'out' | 'low' | 'ok'

export function stockTone(stock: number): StockTone {
  if (stock <= 0) return 'out'
  return stock <= LOW_STOCK_THRESHOLD ? 'low' : 'ok'
}

/** Card/detail label: "OUT OF STOCK" · "ONLY 3 LEFT" · "12 LEFT" */
export function stockLabel(stock: number): string {
  if (stock <= 0) return 'OUT OF STOCK'
  return stock <= LOW_STOCK_THRESHOLD ? `ONLY ${stock} LEFT` : `${stock} LEFT`
}
```

Keep Tailwind class names OUT of this file — it is imported by the server too. Components
map the tone to classes themselves.

- [ ] **Step 2: Extend the `Product` type**

In `app/types/shop.ts`, add to the `Product` interface after `is_active`:

```ts
  stock: number
```

- [ ] **Step 3: Verify**

`yarn build` exits 0. Then confirm the catalog actually carries the field — start the dev
server and check the shop page's SSR payload contains stock values:

```bash
curl -s http://localhost:PORT/shop | grep -o '"stock":[0-9]*' | head -5
```

Expected: several matches. (The catalog query uses `select('*')`, so no query change is
needed — this proves it.)

Report what you changed. **Do not commit.**

---

### Task 2: Server-side stock checks

**Files:**
- Modify: `server/api/orders.post.ts`
- Modify: `server/api/admin/orders/[id].patch.ts`

- [ ] **Step 1: Pre-check in the order route**

In `server/api/orders.post.ts`, add `stock` to the catalog select (currently
`select('id, name, price_cents')`), then after `lines` is built and before the order
insert, reject anything the catalog cannot cover:

```ts
  const short = lines
    .map((l) => {
      const p = products.find(x => x.id === l.product_id)!
      return { name: p.name, want: l.quantity, have: p.stock }
    })
    .filter(s => s.have < s.want)

  if (short.length) {
    throw createError({
      statusCode: 400,
      statusMessage: short
        .map(s => s.have === 0 ? `${s.name} is out of stock` : `${s.name} — only ${s.have} left`)
        .join('; '),
    })
  }
```

- [ ] **Step 2: Map the constraint violation to a readable 409**

The pre-check loses a genuine race. The `order_items` insert then fails on
`products_stock_non_negative`. The existing rollback (delete the order) must still happen;
only the error message changes. In the `if (iErr)` branch, before the current 500:

```ts
  if (iErr) {
    await db.from('orders').delete().eq('id', order.id)
    if (iErr.code === '23514') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Someone just bought the last one — please check your cart and try again.',
      })
    }
    throw createError({ statusCode: 500, statusMessage: iErr.message })
  }
```

- [ ] **Step 3: Same mapping on un-cancel**

In `server/api/admin/orders/[id].patch.ts`, moving an order out of `canceled` re-takes its
stock via the trigger, which can now fail. Where the update error is handled, map `23514`:

```ts
    if (error.code === '23514') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Cannot reopen this order — its items are no longer in stock.',
      })
    }
```

Leave every other behaviour of that route exactly as it is.

- [ ] **Step 4: Verify the ordinary paths**

Dev server up. Read `SUPABASE_URL` / `SUPABASE_KEY` / `SUPABASE_SECRET_KEY` from `.env`
into shell variables **without printing them**.

1. **Normal order reduces stock.** Note a product's stock, POST an order for 2 of it,
   re-query — stock dropped by exactly 2.
2. **Cancel restocks.** PATCH that order to `canceled`, re-query — stock back to the
   original.
3. **Idempotent.** PATCH `canceled` again — stock unchanged.
4. **Un-cancel re-takes.** PATCH to `open` — stock down by 2 again. Then cancel once more
   to release it, and delete the test order with the service-role key.
5. **Over-ordering is refused.** POST an order for 999 of any product → **400**, and the
   message names the product and the amount left.
6. **Out-of-stock product is refused.** POST an order for `dark-cacao-bar-70` (stock 0) →
   **400** saying it is out of stock.

Report the ACTUAL status codes, messages and stock numbers for each.

- [ ] **Step 5: Verify the race — the reason this design exists**

Pick a product and set its stock to exactly 1 (record the original value first):

```bash
curl -s -X PATCH "$SUPABASE_URL/rest/v1/products?slug=eq.<slug>" \
  -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  -H "content-type: application/json" -H "Prefer: return=representation" \
  -d '{"stock":1}'
```

Then fire two checkouts for that product **concurrently** (background both curls with `&`
and `wait`), each ordering qty 1.

Expected: one returns 200 with an order, the other returns **400 or 409** — and stock ends
at exactly **0**, never −1. Report both responses and the final stock.

Note the pre-check may catch the loser first (400) or the constraint may (409); either is
correct. What must NOT happen is two 200s or a negative stock.

Clean up: delete every test order you created (service-role key, filtered on the test
email you used), and restore the product's original stock value.

Report everything. **Do not commit.**

---

### Task 3: Stock on the product card and detail page

**Files:**
- Modify: `app/components/ProductCard.vue`
- Modify: `app/components/QtyStepper.vue`
- Modify: `app/pages/products/[slug].vue`

- [ ] **Step 1: `ProductCard.vue`**

Read the file first. Add:

- an `OUT OF STOCK` badge on the image when `product.stock <= 0`, mirroring the existing
  category badge but positioned `right-3.5 top-3.5` and using `bg-status-canceled text-white`
- a stock line under the price in BOTH the desktop and mobile blocks, using `stockLabel()`
  and a tone→class map defined in the component:
  `out → text-status-canceled`, `low → text-status-open`, `ok → text-muted`,
  styled with the existing `mono-label` class at `text-[10px] font-semibold`
- `:disabled="product.stock <= 0"` on both add buttons, with a disabled appearance
  (`disabled:opacity-40`). The global `button:not(:disabled)` cursor rule in
  `app/assets/css/main.css` already keeps the pointer cursor off disabled buttons.

Do not restructure the card; keep the existing layout and class vocabulary.

- [ ] **Step 2: Give `QtyStepper.vue` bounds**

It currently emits `modelValue ± 1` with no limits, so quantity can reach zero and go
negative. Add optional `min` (default 1) and `max` (default `Infinity`) props and clamp:

```ts
function step(delta: number) {
  const next = Math.min(props.max, Math.max(props.min, props.modelValue + delta))
  if (next !== props.modelValue) emit('update:modelValue', next)
}
```

Disable each button at its bound (`:disabled="modelValue <= min"` /
`:disabled="modelValue >= max"`) with a dimmed style, so the limit is visible rather than
just unresponsive. Existing usages pass no `min`/`max` and must keep working unchanged.

- [ ] **Step 3: `app/pages/products/[slug].vue`**

- Show the same stock line near the price, with the same tone→class mapping. On the dark
  band use a legible variant of the tones (check contrast against `bg-espresso`; the
  existing code uses `text-[#EFE4D8]/72` for muted text there).
- Pass `:max="product.stock"` to the `QtyStepper`, and clamp `qty` back into range when
  the route changes (it already resets to 1).
- Disable the add-to-cart button when `product.stock <= 0` and label it `Out of stock`.

- [ ] **Step 4: Verify**

`yarn build` exits 0, then with the dev server up:

```bash
curl -s http://localhost:PORT/shop | grep -c 'OUT OF STOCK'     # expect 1 (dark-cacao-bar-70)
curl -s http://localhost:PORT/shop | grep -o 'ONLY [0-9] LEFT' | sort -u   # expect ONLY 2 / ONLY 5
curl -s http://localhost:PORT/shop | grep -o '[0-9]* LEFT' | head           # expect a mix
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:PORT/products/dark-cacao-bar-70
```

Expected: exactly one out-of-stock card, the low labels for the products at 2 and 5, and
the detail page still 200.

Confirm the dev server log shows no Vue warnings or hydration errors.

Interactive checks (dialog-free but still visual) **cannot** be done without a browser —
list precisely what the owner should look at.

Report what you changed. **Do not commit.**

---

## Done when

- Ordering reduces stock; canceling restores it; re-clicking cancel does nothing.
- Over-ordering and out-of-stock products are refused with readable messages.
- Two concurrent checkouts for the last unit cannot both succeed, and stock never goes
  negative.
- The shop shows `12 LEFT`, `ONLY 2 LEFT` and `OUT OF STOCK` in the right places, with the
  add button disabled at zero.
- Every change is in the working tree, uncommitted.
