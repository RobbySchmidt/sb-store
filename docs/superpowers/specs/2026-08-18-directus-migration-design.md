# Directus migration — design

**Date:** 2026-08-18
**Branch:** `directus-migration`
**Status:** approved, not yet implemented

Replaces the Supabase backend of "Ember & Oak" with a self-hosted Directus
instance. Full replacement: catalog, orders, auth and roles, and product images
all move. Supabase is dropped, not kept alongside.

---

## 1. The instance we are migrating onto

`https://directuscon.axtlust.de` — Directus **11.6.1**, MySQL, `local` storage
driver, self-hosted (not Docker). Verified by inspection on 2026-08-18:

- **It is shared with other projects.** `Cascade_Academy` (six `cascade_*`
  collections), a `Robby` folder (`project_style`, `accent_colors`,
  `primary_colors`, `secondary_colors`), and `shader_presets`. **None of these
  are touched by this work.**
- `Ember_Oak_Shop` exists as an empty collection group. All new collections go
  inside it.
- Roles: `Administrator`, and `Kunde` — *"Endkunde der Website. Kann eigene
  Daten bearbeiten und Touren buchen"*, belonging to the tour-booking project.
  Not ours, not reused.
- Policies: `Administrator`, `Kunde Policy`, `api`, `Public`.
- Six users, all Administrator, including `schmidt@rhowerk.de`.
- The file library has **no folders**.
- One flow (`Slugify`), one extension (`schema-management-module`).
- SMTP is configured and healthy (`email:connection: ok`).
- `public_registration` is **on**, and `public_registration_role` points at
  `Kunde` — i.e. today, public signups land in the *other* project's role.

### The constraint that shaped everything

**There is no raw SQL access to the MySQL database — only the Directus API.**

This invalidates the plan recorded in CLAUDE.md, which assumed the stock
triggers and `check (stock >= 0)` could be ported to MySQL. They cannot:
Directus exposes no API for `CREATE TRIGGER`, and its field API cannot create
`CHECK` constraints.

It also rules out the obvious fallback. Directus `PATCH` writes **absolute**
values, never relative ones, so any stock decrement from Nitro is a
read-modify-write: two concurrent checkouts both read `1` and both write `0`.
Filtered updates do not rescue this — Directus resolves a filter to a set of
primary keys in one query and updates by key in a second, so a
`?filter[stock][_gte]=n` update is **not** a compare-and-swap.

The mutable-counter design therefore has no safe home on this instance. Rather
than bolt a weaker guard onto the same shape, the shape changes — see §3.

### Verified capabilities

Both checked against the live instance before committing to the design:

- `aggregate[sum]` + `groupBy` + a filter on a **related** collection's field
  returns correct grouped sums on 11.6.1. This is the single call derived stock
  depends on.
- `on_delete: CASCADE` and `SET NULL` are both supported on relations.
- `GET /policies/me/globals` returns `{admin_access, app_access, enforce_tfa}`
  computed across every policy attached to the user *and* their role. One call,
  no manual OR-ing of policies.

---

## 2. Data model

Four collections, all in the `Ember_Oak_Shop` group, all prefixed `eo_`.

The group is a UI folder only. Underneath, every collection on the instance
shares one MySQL table namespace, and `products` / `orders` are exactly the
names the next project would also want. The Cascade project set this precedent
with `cascade_*`.

### `eo_categories`

| field | type | notes |
|---|---|---|
| `id` | uuid | PK |
| `name` | string | required |
| `slug` | string | required, **unique** |
| `sort_order` | integer | default 0 |
| `date_created` | timestamp | Directus special field |

### `eo_products`

| field | type | notes |
|---|---|---|
| `id` | uuid | PK |
| `category` | m2o → `eo_categories` | required |
| `name` | string | required |
| `slug` | string | required, **unique** |
| `tagline` | string | |
| `description` | text | |
| `price_cents` | integer | required, validation `>= 0` |
| `image` | m2o → `directus_files` | replaces the absolute `image_url` |
| `is_active` | boolean | default true |
| `meta` | json | default `{}` |
| `stock_initial` | integer | default 0 — see §3 |
| `date_created` | timestamp | |

### `eo_orders`

| field | type | notes |
|---|---|---|
| `id` | uuid | PK |
| `order_number` | string | required, **unique** |
| `status` | string | dropdown `open` / `marked` / `canceled`, default `open` |
| `customer_name`, `email`, `street`, `zip`, `city`, `country` | string | required |
| `subtotal_cents`, `shipping_cents`, `total_cents` | integer | required, `>= 0` |
| `cancel_reason`, `cancel_note` | string / text | nullable |
| `user` | m2o → `directus_users` | nullable, **on delete SET NULL** |
| `items` | o2m ← `eo_order_items.order` | alias field; the o2m side of the line relation |
| `date_created`, `date_updated` | timestamp | Directus special fields |

### `eo_order_items`

| field | type | notes |
|---|---|---|
| `id` | uuid | PK |
| `order` | m2o → `eo_orders` | required, **on delete CASCADE** |
| `product` | m2o → `eo_products` | nullable, **on delete SET NULL** |
| `product_name` | string | required — **snapshot** |
| `unit_price_cents` | integer | required — **snapshot** |
| `quantity` | integer | required, validation `>= 1` |

### What this buys

- **`date_updated` is a Directus special field**, so the `orders_set_updated_at`
  trigger disappears rather than needing a port.
- **`status` is a validated dropdown**, so no MySQL enum equivalent is needed
  for `order_status`.
- **`user` is SET NULL, never CASCADE** — deleting an account must orphan order
  history, never erase it. Unchanged from today.
- **The snapshot rule is unchanged.** `product_name` and `unit_price_cents` stay
  on the line so an order survives a rename or reprice. `product` remains a live
  relation used *only* for the thumbnail and link, still SET NULL, so a deleted
  product degrades to text behind `v-if`. The slug is still deliberately not
  snapshotted — a stored slug for a deleted product still 404s, so the link
  needs the live row either way.

### Weakened, knowingly

The `check (price_cents >= 0)` family becomes Directus **field validation**,
enforced at the API layer rather than by the database. Every write goes through
Directus, so it holds in practice, but it is no longer a hard guarantee.

---

## 3. Stock

`products.stock` (a mutable counter) is replaced by **`stock_initial`**, and
availability is derived:

```
available(p) = stock_initial(p)
             − Σ quantity over eo_order_items
               where order.status ≠ 'canceled' and product = p
```

fetched in one call:

```
GET /items/eo_order_items
    ?aggregate[sum]=quantity
    &groupBy=product
    &filter[order][status][_neq]=canceled
```

`/api/catalog` attaches the result to each product as **`stock_available`** — a
computed number, not a stored column. `stock_initial` is the only stock value
that exists in the database, which is what makes the whole thing safe.

### Consequences

- **Checkout is insert-only.** Nothing is decremented, so there is no lost
  update to lose.
- **Cancellation needs no give-back, and un-cancellation no re-take.** The
  filter does both. `take_stock_for_item`, `apply_order_stock` and
  `sync_stock_on_status` cease to exist rather than being ported.
- **Hand-editing an order line stops being a footgun.** Under the trigger design
  that silently corrupted the invariant, because the take was recorded at insert
  while the give-back read current values. Under the derived model, editing a
  line is simply correct.
- **The Postgres `23514` → MySQL `3819` remapping is not needed at all.** No
  constraint violation is ever raised, so there is no vendor error code to map.
  This also retires the unresolved MySQL-vs-MariaDB question (3819 vs 4025) and
  the MySQL 8.0.16 `CHECK`-enforcement question.

### The remaining race, and how it is closed

Deriving stock removes the lost update but not the check-then-insert window: two
checkouts can both compute "1 available" and both insert.

That window is closed by a **module-level async lock in Nitro**, held across
read-availability → verify → insert. Two places take it:

1. **Checkout** (`server/api/orders.post.ts`) — recompute availability, return
   400 with today's wording (`"X is out of stock"` / `"X — only N left"`) if
   short, then insert order and lines.
2. **Reopening a canceled order** (`server/api/admin/orders/[id].patch.ts`) — a
   transition *out of* `canceled` re-takes stock, so it checks availability
   first and returns 409 with today's wording (`"Cannot reopen this order — its
   items are no longer in stock."`). This case survives; only its mechanism
   changes.

**This is correct for a single Nitro process, and only for that.** It is not a
database guarantee and must not be described as one. If the shop is ever run
across multiple instances, that is the moment to obtain MySQL credentials and
reinstate a trigger-based guard — the derived model permits that, it simply does
not depend on it.

### Order numbers

The `EO-YYYY-NNNN` Postgres sequence does not survive. Nitro generates the
number inside the same lock: read the highest `order_number` for the current
year, increment, insert. `order_number` carries a **unique constraint**, which
Directus *can* create — so that one guarantee stays in the database. A
duplicate-key failure is retried once.

---

## 4. Auth and roles

### Role mapping

- **Customers** get a new, dedicated `Ember & Oak Customer` role and policy.
  Registration goes through our own Nitro route using the admin token, so
  `public_registration_role` — a single global setting the tour project depends
  on — is never touched. `public_registration` can stay on or be turned off; it
  becomes irrelevant to this shop.
- **Admins** are any Directus user with `admin_access`. `schmidt@rhowerk.de`
  already qualifies, so no new account is needed.
  **Accepted trade-off:** the other five Administrators on the instance
  (`klein@`, `koppe@`, `borbe@`, `mcp@axtlust.de`, and one with no email) also
  get the shop dashboard. Changing this later means editing `requireAdmin()`
  only, since it is the single gate.

### `server/utils/auth.ts`

Keeps all three functions with **identical signatures**, so every caller stays
untouched. This is the seam.

```
currentUser(event)  → SessionUser | null   never throws; guest checkout
requireUser(event)  → 401
requireAdmin(event) → 403   via GET /policies/me/globals → admin_access
```

`SessionUser` becomes `{ id, email, isAdmin }`.

**The `sub`-vs-`id` trap is gone.** `/users/me` returns a real row whose id is
`id`. The two long comment blocks warning about it (in `auth.ts` and
`useProfile.ts`) are deleted, not rewritten.

### Sessions

Nitro-managed httpOnly cookies. Login POSTs to Directus `/auth/login`
(`mode: json`) and stores the access token and refresh token.

Deliberately **not** Directus's own session-cookie mode: that needs the browser
talking cross-origin to `directuscon.axtlust.de` with `SameSite=None`, and puts
a Directus session cookie on a domain we do not control.

Directus rotates refresh tokens on use, so `currentUser()` refreshes only when
the access token is absent or expired, and treats a failed refresh as "signed
out" rather than as an error.

### Guest checkout

Unchanged. `eo_orders.user` is stamped when a signed-in person checks out, and
`/api/account/orders` still falls back to matching the account email, so guest
orders surface once you register with that address.

The existing caveat carries over: that fallback is trust-on-assertion unless
email verification is on. Directus's `public_registration_verify_email` is
currently `false`, and our own registration route does not verify either.
Accepted for a fake shop, same as today.

---

## 5. Route and component inventory

### Directus vocabulary reaches the client — no translation shim

An earlier draft had Nitro renaming Directus's fields back to the PostgREST
names the app uses today (`date_created` → `created_at`, `image` → `image_url`,
`product` → `product_id`, and a nested key called `products` holding a single
object). That was rejected: it is a **permanent** translation layer whose only
purpose is avoiding a **one-time** rename, and it would leave the app speaking a
vocabulary no part of the stack uses any more.

The app uses Directus's names.

| today | after |
|---|---|
| `products.image_url` (absolute URL) | `image` (file id) + `assetUrl()` |
| `products.category_id`, nested `categories` | `category` (expandable) |
| `products.stock` | `stock_available` (computed, see §3) |
| `orders.created_at` / `updated_at` | `date_created` / `date_updated` |
| `orders.user_id` | `user` |
| `orders.order_items[]` | `orders.items[]` (o2m alias) |
| `order_items.product_id`, nested `products` | `product` (expandable) |

### Types come from a Directus schema, not by hand

`shared/types/directus.ts` declares one interface per collection plus the
`Schema` type that parameterises `@directus/sdk`. Server queries are typed
end-to-end from it, and `app/` imports the same interfaces for route response
shapes. This replaces both hand-written `app/types/shop.ts` model types **and**
the generated `app/types/database.types.ts` we are deleting — so the
regeneration step in Conventions goes away rather than being replaced by another
one.

`app/types/shop.ts` keeps only genuinely client-side view models: `CartItem`,
`ProductMeta`.

### Images use asset transformations

`assetUrl(id, { width, format })` in `shared/utils/` builds
`${DIRECTUS_URL}/assets/<id>?…`. Product cards request a sized `webp` rather
than the full-resolution original, which the Supabase Storage absolute URLs
could not do. `BrandMark.vue`'s hardcoded Supabase URL becomes a call to it.

### What this costs, and how it is caught

Mechanical renames across roughly a dozen `.vue` files and the three mail
templates. **There is no test suite to catch a missed rename, and neither
`yarn dev` nor `yarn build` typechecks** — so the pinned `vue-tsc` command in
Conventions is not optional here, it is the safety net. It runs after the rename
pass and again at the end (see §9).

`shared/utils/shop.ts` still needs no changes: `stockTone()`, `stockLabel()` and
`LOW_STOCK_THRESHOLD` are pure functions of a number, and `stock_available` is a
number.

### New

| route | purpose |
|---|---|
| `GET /api/catalog` | categories + active products + derived availability |
| `POST /api/auth/register` | creates the user with the customer role, then logs in |
| `POST /api/auth/login` | |
| `POST /api/auth/logout` | |
| `GET /api/auth/me` | returns the session user or null; feeds `useProfile()` |

`/api/catalog` exists because derived stock requires an aggregate over
`eo_order_items`, and order lines can never be public. The catalog can no longer
be read directly by the browser the way RLS allowed. The static token stays
server-only, and one place knows how to compute availability.

### Rewritten

- `server/utils/auth.ts` — three functions, same signatures
- `server/api/orders.post.ts` — lock, derived availability, order-number
  generation, insert order then lines
- `server/api/admin/orders.get.ts`
- `server/api/admin/orders/[id].patch.ts` — plus the reopen availability check
- `server/api/account/orders.get.ts` — still two queries merged (user match +
  email fallback), same reasoning as today
- `app/composables/useShop.ts` — `useCatalog()` becomes `useFetch('/api/catalog')`
- `app/composables/useProfile.ts` — fed by `/api/auth/me`. Keeps `profile`,
  `role`, `isAdmin`, `landingPath` and `refresh`. **`loadFor(id)` is dropped**:
  it existed only because Supabase's reactive user ref lagged behind
  `signInWithPassword()`, and our own login route returns the user directly.
  Its two callers in `login.vue` and `register.vue` switch to `refresh()`.
- `app/middleware/{auth,admin,redirect-if-signed-in}.ts`
- `app/pages/{login,register,account,admin}.vue`,
  `app/components/{AccountMenu,StoreHeader}.vue` — sign-out posts to
  `/api/auth/logout`
- `app/components/BrandMark.vue` — hardcoded Supabase Storage URL becomes an
  `assetUrl()` call
- `nuxt.config.ts` — drop the `@nuxtjs/supabase` module and its `supabase` block

Touched by the rename pass only, since Directus names now reach the client:

- `app/pages/{index,shop,cart,checkout,confirmation}.vue`,
  `app/pages/products/[slug].vue`, `app/components/ProductCard.vue`
- `server/utils/email/{confirmation,shipped,canceled}.ts` — field names only;
  the shared chrome in `shell.ts` is untouched
- `app/types/shop.ts` — reduced to `CartItem` and `ProductMeta`

### New files

- `shared/types/directus.ts` — collection interfaces + the `Schema` type
- `shared/utils/assetUrl.ts` — builds `/assets/<id>?width=…&format=webp`
- `server/utils/directus.ts` — the SDK client on the static token
- `server/utils/stock.ts` — the availability aggregate and the checkout lock
- `directus/setup.ts` — the idempotent schema + seed script

> Editing `shared/` needs a dev-server restart. Nuxt's auto-import watcher only
> watches paths under `app/`, so new exports there are invisible to a running
> dev server.

### Deleted

- `server/utils/supabaseAdmin.ts` → replaced by `server/utils/directus.ts`
- `app/types/database.types.ts` (generated from the Supabase schema)
- the `@nuxtjs/supabase` dependency

`supabase/*.sql` stays on disk until the migration is verified working — it is
the only written record of the old system — and is removed in a follow-up.

### Unchanged

- `server/utils/mailer.ts` and `server/utils/email/shell.ts`. Sends stay
  fire-and-forget via `event.waitUntil(...).catch(...)`, and every `send*`
  function stays `async` so a synchronous throw becomes a catchable rejection.
- `shared/utils/shop.ts` — `stockTone()`, `stockLabel()`, `fmtPrice()`,
  `batchInfo()`, `deliveryWindow()` are all pure functions of numbers and dates.
- `shared/utils/cancelReasons.ts`
- `app/stores/cart.ts` — `CartItem` is a client-side view model, not a row.

---

## 6. Migration sequence

The schema is built by a **scripted, re-runnable setup** (`directus/setup.ts`,
run via `yarn directus:setup`) rather than by clicking through the admin UI.
That script becomes what `supabase/*.sql` used to be: the checked-in,
reproducible record of the datastore. It matters more than usual here, because
this repo is worked on from two machines.

1. Create the `Ember & Oak Customer` role and policy — near-empty, since all
   data access is server-side
2. Create the `Ember & Oak` file-library folder
3. Create the four collections, fields and relations under `Ember_Oak_Shop`
4. Seed categories and products from the existing SQL content, including the
   `meta` JSON and the stock numbers as `stock_initial`
5. Download the 12 product images from Supabase Storage, upload them into the
   folder, set `eo_products.image`
6. Grant the **Public** policy read on `directus_files`, **scoped to that folder
   only**, so images render from `/assets/<id>`. The collections themselves stay
   private.
7. Reseed the 8 demo orders by direct insert — deliberately **not** through
   `/api/orders`, so no confirmation mail fires at `felix.m@mail.de` and the
   other fake addresses
8. Write `shared/types/directus.ts` and `server/utils/directus.ts`
9. Rewrite the server routes and `auth.ts`
10. Rename pass across `app/` and the three mail templates, then **typecheck**
    before going further — a missed rename is silent until it renders
11. Delete the Supabase module, dependency, `supabaseAdmin.ts` and
    `database.types.ts`
12. Move mail to the company SMTP server (§7)

## 7. Mail

In scope for this work. `server/utils/mailer.ts` is entirely driven by `MAIL_*`
env vars, so this is an `.env` change with no code change.

`.env` currently holds `EMAIL_HOST=mail.agenturserver.de`,
`EMAIL_ADDRESS=contact@rholing.de` and `EMAIL_SECRET` — and **nothing reads any
of them**. Those values move into the `MAIL_*` keys the transport actually
reads, and the `EMAIL_*` decoys are deleted. Do not add `EMAIL_*` support to
`mailer.ts`.

> ⚠️ Once this lands, order mail goes to **real inboxes**. Mailpit is no longer
> catching anything. Use your own address when testing checkout.

The Mailpit compose file can stay for offline work, but is no longer wired up by
default.

## 8. Environment

`.env` loses `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SECRET_KEY` and
`DATABASE_URL`; keeps `DIRECTUS_URL` and `DIRECTUS_API_TOKEN`; and gains real
`MAIL_*` values. `.env.example` documents all of it.

`DIRECTUS_API_TOKEN` is currently a static token on `schmidt@rhowerk.de`, a full
Administrator. That mirrors the trust model the service-role key has today and
is accepted. **Noted for later:** it means the shop backend authenticates as you
and can reach the Cascade and Robby collections too. Moving it to a dedicated
non-admin API user with a scoped policy is a contained follow-up — the instance
already has an `api` policy suggesting that pattern — and touches only
`server/utils/directus.ts`.

Because `yarn directus:setup` is idempotent and the schema lives on a shared
hosted instance, nothing needs redoing by hand on the second machine beyond
recreating `.env`.

## 9. Verification

No test framework, by choice. Verified by running things:

- `yarn directus:setup` twice — the second run is a no-op
- catalog renders with images, stock badges, and the out-of-stock and low-stock
  cards visible
- checkout as a guest, and signed in
- the order appears in `/admin` and in `/account`
- cancel an order → its stock returns to the catalog
- reopen it when stock is gone → 409 with the friendly message
- an order for more than the available stock → 400 with the friendly message
- confirmation, shipped and canceled mails arrive at a real address
- `/api/dev/preview-mail?template=…` still renders all three
- product images load as sized `webp` via `assetUrl()`, not full-resolution
  originals

**Typecheck twice — once immediately after the rename pass, once at the end:**

```bash
npx --yes -p vue-tsc@2.2.10 -p typescript@5.8.3 vue-tsc --noEmit -p .nuxt/tsconfig.json
```

Exit 0 with no output means clean. **Verify it really ran** — an empty result
from a crashed run looks identical to a pass if you only grep for errors. This
is the only mechanical check that a field rename was missed; there is no test
suite, and neither `yarn dev` nor `yarn build` typechecks.

## 10. Out of scope

- Reinstating a database-level stock guard (needs MySQL credentials)
- Moving `DIRECTUS_API_TOKEN` to a dedicated non-admin API user
- Migrating the real Supabase orders — demo orders are reseeded instead
- Deciding the fate of `public_registration` on the shared instance; this design
  makes the shop independent of it either way
