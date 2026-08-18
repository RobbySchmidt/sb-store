# Directus Migration Implementation Plan

> **STATUS: EXECUTED AND VERIFIED, 2026-08-18.** All 15 tasks are done and the
> app runs on Directus with Supabase removed. Left uncommitted for review.
>
> Three bugs in this plan were found during execution and are corrected inline,
> each marked where it bit:
> 1. **Task 4** — role/folder creation was not idempotent (`directus_roles.name`
>    and `directus_folders.name` have no unique constraint, so POST-and-catch
>    silently duplicated on every run).
> 2. **Task 10** — login and register always returned `null`; `setCookie` writes
>    the response while `getCookie` reads the request.
> 3. **Task 12** — `$fetch` sends no cookies during SSR, so a signed-in admin
>    hard-loading `/admin` was bounced to `/`.
>
> Two other corrections: the Task 8 availability table had `sunrise` wrong
> (held 5, not 3), and the mail field references live in `email/shell.ts`, not
> in the three template files.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Supabase backend of "Ember & Oak" with the self-hosted Directus instance at `directuscon.axtlust.de`, moving catalog, orders, auth and images, and switching order mail to the company SMTP server.

**Architecture:** Four `eo_*` collections in the `Ember_Oak_Shop` group. Stock is *derived* (`stock_initial` minus the sum of order lines on non-canceled orders) rather than stored as a counter, because Directus offers no way to create the trigger and `CHECK` constraint that guarantee the invariant today. Nitro keeps ownership of pricing, the stock check, order-number generation and mail; the browser talks only to Nitro routes. The app uses Directus's own field vocabulary — there is no translation layer.

**Tech Stack:** Nuxt 4 (app/ + Nitro), `@directus/sdk`, Pinia, Tailwind 4, nodemailer. Package manager is **yarn** — never npm.

**Spec:** [`docs/superpowers/specs/2026-08-18-directus-migration-design.md`](../specs/2026-08-18-directus-migration-design.md)

---

## Rules for this plan

**No commit steps.** CLAUDE.md: *"Never commit or push automatically. Make the changes and leave them in the working tree."* This plan therefore contains no `git commit` steps, and any subagent dispatched to execute a task must be told explicitly not to commit. Report when work is ready and suggest a message instead.

**No test framework, by choice.** CLAUDE.md: *"Verify by running things: `yarn dev`, curl the API, check the mail inbox."* Every task ends with a concrete command and its expected output instead of a test file. Do not introduce a test framework.

**Do not touch other projects on the instance.** `Cascade_Academy` and its six `cascade_*` collections, the `Robby` folder (`project_style`, `accent_colors`, `primary_colors`, `secondary_colors`), and `shader_presets` belong to other projects. Every collection this plan creates goes inside the existing `Ember_Oak_Shop` group.

**Don't run `yarn build` while a dev server is running.** They share `node_modules/.cache/nuxt/.nuxt` and the build kills the server.

**Editing `shared/` needs a dev-server restart.** Nuxt's auto-import watcher only watches paths under `app/`.

**The typecheck command** (used repeatedly below) — TypeScript is not a dependency and nothing typechecks on build, so this is the only mechanical check that a rename was missed:

```bash
npx --yes -p vue-tsc@2.2.10 -p typescript@5.8.3 vue-tsc --noEmit -p .nuxt/tsconfig.json
```

Exit 0 with **no output** means clean. Verify it actually ran — a crashed run and a pass look identical if you only grep for errors. Run `echo "exit: $?"` after it.

---

## File structure

**Created**

| file | responsibility |
|---|---|
| `shared/types/directus.ts` | one interface per collection + the `Schema` type for the SDK |
| `shared/utils/assetUrl.ts` | builds `/assets/<id>?width=…&format=webp` |
| `server/utils/directus.ts` | the SDK client on the static token (the `supabaseAdmin()` analogue) |
| `server/utils/stock.ts` | the availability aggregate and the checkout lock |
| `server/api/catalog.get.ts` | categories + active products + `stock_available` |
| `server/api/auth/login.post.ts` | | 
| `server/api/auth/logout.post.ts` | |
| `server/api/auth/register.post.ts` | creates the user with the customer role, then logs in |
| `server/api/auth/me.get.ts` | feeds `useProfile()` |
| `directus/setup.ts` | idempotent schema + role + folder creation |
| `directus/seed.ts` | categories, products, images, demo orders |
| `directus/seed-data.ts` | the catalog content, transcribed from `supabase/*.sql` |

**Modified:** `server/utils/auth.ts`, `server/api/orders.post.ts`, `server/api/admin/orders.get.ts`, `server/api/admin/orders/[id].patch.ts`, `server/api/account/orders.get.ts`, `server/utils/email/{confirmation,shipped,canceled}.ts`, `app/composables/{useShop,useProfile}.ts`, `app/middleware/*.ts`, `app/pages/*.vue`, `app/components/{ProductCard,BrandMark,AccountMenu,StoreHeader}.vue`, `app/types/shop.ts`, `nuxt.config.ts`, `.env.example`, `CLAUDE.md`

**Deleted:** `server/utils/supabaseAdmin.ts`, `app/types/database.types.ts`

---

## Task 1: Directus client and dependency

**Files:**
- Create: `server/utils/directus.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the SDK**

```bash
yarn add @directus/sdk
```

- [ ] **Step 2: Remove the Supabase dependency check from your mental model — not yet from package.json.** The app must keep running on Supabase until Task 13. Do not remove `@nuxtjs/supabase` here.

- [ ] **Step 3: Write the client**

`server/utils/directus.ts` — files in `server/utils/` are auto-imported into server routes, so no import statement is needed at call sites (the same way `supabaseAdmin()` is used).

```ts
import { createDirectus, rest, staticToken } from '@directus/sdk'
import type { Schema } from '../../shared/types/directus'

let client: ReturnType<typeof build> | null = null

function build() {
  const url = process.env.DIRECTUS_URL
  const token = process.env.DIRECTUS_API_TOKEN
  if (!url || !token) throw new Error('DIRECTUS_URL / DIRECTUS_API_TOKEN missing in env')
  return createDirectus<Schema>(url).with(staticToken(token)).with(rest())
}

/** Admin client on the static token — full access. Server-side only. */
export function directus() {
  if (!client) client = build()
  return client
}

/** Base URL for building /assets and /auth URLs. */
export function directusUrl(): string {
  const url = process.env.DIRECTUS_URL
  if (!url) throw new Error('DIRECTUS_URL missing in env')
  return url.replace(/\/$/, '')
}
```

- [ ] **Step 4: Verify the dependency installed**

Run: `node -e "console.log(require('@directus/sdk/package.json').version)"`
Expected: a version number, no error. `shared/types/directus.ts` does not exist yet, so this file will not typecheck until Task 2 — that is expected.

---

## Task 2: Schema types

**Files:**
- Create: `shared/types/directus.ts`

- [ ] **Step 1: Write the collection interfaces**

These are the shapes the whole app now speaks. Note the Directus names — `date_created`, `image`, `category`, `product`, `user`, `items` — and that relational fields are `string | <Expanded>` because they arrive as an id unless the query expands them.

```ts
export interface EoCategory {
  id: string
  name: string
  slug: string
  sort_order: number
  date_created: string
}

export interface ProductMeta {
  weight_g?: number
  meta_line?: string
  roast_pct?: number
  flavors?: string[]
}

export interface EoProduct {
  id: string
  /** An id unless the query expands it. /api/catalog expands id+name+slug. */
  category: string | Pick<EoCategory, 'id' | 'name' | 'slug'>
  name: string
  slug: string
  tagline: string | null
  description: string | null
  price_cents: number
  /** directus_files id. Build a URL with assetUrl(). */
  image: string | null
  is_active: boolean
  meta: ProductMeta
  stock_initial: number
  date_created: string
  /** Computed by /api/catalog — never a stored column. */
  stock_available?: number
}

export type OrderStatus = 'open' | 'marked' | 'canceled'

export interface EoOrderItem {
  id: string
  order: string | EoOrder
  /** Live catalog relation, for the thumbnail and link only. Null once the
   *  product is deleted — name and price stay snapshotted on this row. */
  product: string | Pick<EoProduct, 'id' | 'slug' | 'image'> | null
  product_name: string
  unit_price_cents: number
  quantity: number
}

export interface EoOrder {
  id: string
  order_number: string
  status: OrderStatus
  customer_name: string
  email: string
  street: string
  zip: string
  city: string
  country: string
  user: string | null
  subtotal_cents: number
  shipping_cents: number
  total_cents: number
  cancel_reason: string | null
  cancel_note: string | null
  date_created: string
  /** Directus special field — in practice when the status last changed,
   *  which is what the shipped delivery estimate counts from. */
  date_updated: string
  items: EoOrderItem[]
}

export interface Schema {
  eo_categories: EoCategory[]
  eo_products: EoProduct[]
  eo_orders: EoOrder[]
  eo_order_items: EoOrderItem[]
}

/** The signed-in person, normalised. Returned by /api/auth/me. */
export interface SessionUser {
  id: string
  email: string | null
  isAdmin: boolean
}
```

- [ ] **Step 2: Verify it parses**

Run: `npx --yes -p typescript@5.8.3 tsc --noEmit --skipLibCheck shared/types/directus.ts`
Expected: no output, exit 0.

---

## Task 3: Asset URL helper

**Files:**
- Create: `shared/utils/assetUrl.ts`

Pure helpers shared by app and server go in `shared/utils/` — they are auto-imported into both.

- [ ] **Step 1: Write it**

`DIRECTUS_URL` must be readable on the client, so it is exposed through `runtimeConfig.public` in Step 2 rather than `process.env`.

```ts
export interface AssetOptions {
  width?: number
  height?: number
  quality?: number
  format?: 'webp' | 'jpg' | 'png'
  fit?: 'cover' | 'contain' | 'inside' | 'outside'
}

/**
 * URL for a Directus file. Returns null for a missing file so callers can
 * keep using `v-if` rather than rendering a broken image.
 *
 * Transformations are the reason images are stored as file ids rather than
 * absolute URLs: a product card asks for the size it actually paints.
 */
export function assetUrl(
  base: string,
  id: string | null | undefined,
  opts: AssetOptions = {},
): string | null {
  if (!id) return null
  const q = new URLSearchParams()
  if (opts.width) q.set('width', String(opts.width))
  if (opts.height) q.set('height', String(opts.height))
  if (opts.quality) q.set('quality', String(opts.quality))
  if (opts.format) q.set('format', opts.format)
  if (opts.fit) q.set('fit', opts.fit)
  const qs = q.toString()
  return `${base.replace(/\/$/, '')}/assets/${id}${qs ? `?${qs}` : ''}`
}
```

- [ ] **Step 2: Expose the base URL to the client**

Modify `nuxt.config.ts` — add a `runtimeConfig` block. Leave the `modules` array and the `supabase` block alone for now; they are removed in Task 13.

```ts
  runtimeConfig: {
    public: {
      directusUrl: process.env.DIRECTUS_URL,
    },
  },
```

- [ ] **Step 3: Verify**

Restart the dev server (`yarn dev`) — `shared/` changes are invisible to a running one. Then in any page temporarily, or via the Nuxt devtools console, confirm `useRuntimeConfig().public.directusUrl` returns `https://directuscon.axtlust.de`.

---

## Task 4: Directus schema setup script

**Files:**
- Create: `directus/setup.ts`
- Modify: `package.json` (add the script)

This script is what `supabase/*.sql` used to be: the checked-in, reproducible record of the datastore. It must be **idempotent** — running it twice is a no-op — because it is how the second machine gets a matching instance.

It uses raw REST rather than the SDK. The payload shapes below were chosen to match what the live 11.6.1 instance returns for existing collections; if one is rejected, `GET /fields/cascade_courses` shows a known-good example on the same instance.

- [ ] **Step 1: Write the helper scaffolding**

```ts
/**
 * Idempotent Directus schema setup for Ember & Oak.
 *
 * Run with:  yarn directus:setup
 *
 * Creates the role, the file folder, and the four eo_* collections inside the
 * existing Ember_Oak_Shop group. Never touches Cascade_Academy, Robby,
 * shader_presets or anything else on this shared instance.
 */
const URL = (process.env.DIRECTUS_URL || '').replace(/\/$/, '')
const TOKEN = process.env.DIRECTUS_API_TOKEN
if (!URL || !TOKEN) throw new Error('DIRECTUS_URL / DIRECTUS_API_TOKEN missing in env')

const GROUP = 'Ember_Oak_Shop'

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) {
    const msg = body?.errors?.[0]?.message ?? res.statusText
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${msg}`)
  }
  return body?.data
}

/** POST that treats "already exists" as success — this is what makes it idempotent. */
async function ensure(path: string, payload: unknown, label: string): Promise<void> {
  try {
    await api(path, { method: 'POST', body: JSON.stringify(payload) })
    console.log(`  created  ${label}`)
  } catch (e: any) {
    if (/already exists|has to be unique|RECORD_NOT_UNIQUE/i.test(e.message)) {
      console.log(`  exists   ${label}`)
      return
    }
    throw e
  }
}
```

- [ ] **Step 2: Add the collection builders**

```ts
const uuidPk = {
  field: 'id',
  type: 'uuid',
  meta: { hidden: true, readonly: true, interface: 'input', special: ['uuid'] },
  schema: { is_primary_key: true, length: 36, has_auto_increment: false },
}

function str(field: string, o: { required?: boolean; unique?: boolean; long?: boolean } = {}) {
  return {
    field,
    type: o.long ? 'text' : 'string',
    meta: {
      interface: o.long ? 'input-multiline' : 'input',
      required: !!o.required,
    },
    schema: { is_nullable: !o.required, is_unique: !!o.unique },
  }
}

function int(field: string, o: { required?: boolean; min?: number; def?: number } = {}) {
  return {
    field,
    type: 'integer',
    meta: {
      interface: 'input',
      required: !!o.required,
      ...(o.min !== undefined
        ? { validation: { [field]: { _gte: o.min } } }
        : {}),
    },
    schema: { is_nullable: !o.required, default_value: o.def ?? null },
  }
}

async function createCollection(name: string, icon: string, fields: unknown[]) {
  await ensure('/collections', {
    collection: name,
    meta: { group: GROUP, icon, sort_field: null },
    schema: {},
    fields: [uuidPk],
  }, `collection ${name}`)

  for (const f of fields as any[]) {
    await ensure(`/fields/${name}`, f, `${name}.${f.field}`)
  }
}

/** m2o relation. on_delete is the whole point — get it right. */
async function relate(
  collection: string,
  field: string,
  related: string,
  onDelete: 'CASCADE' | 'SET NULL' | 'NO ACTION',
  oneField: string | null = null,
) {
  await ensure('/relations', {
    collection,
    field,
    related_collection: related,
    meta: { one_field: oneField, sort_field: null, one_deselect_action: 'nullify' },
    schema: { on_delete: onDelete },
  }, `relation ${collection}.${field} → ${related} (${onDelete})`)
}
```

- [ ] **Step 3: Add the four collections**

```ts
async function main() {
  console.log(`Directus setup → ${URL}`)

  // ---- role for shop customers ----
  // Deliberately a NEW role, not the existing "Kunde" — that one belongs to
  // the tour-booking project on this shared instance.
  console.log('\nRole')
  await ensure('/roles', {
    name: 'Ember & Oak Customer',
    icon: 'local_cafe',
    description: 'Customer account for the Ember & Oak shop.',
  }, 'role Ember & Oak Customer')

  // ---- policy: the smallest thing that works ----
  // A customer needs no access to eo_* at all — every bit of shop data is read
  // server-side with the static admin token — and gets none. The one thing they
  // must read is their OWN email: /api/account/orders matches it to surface
  // orders placed as a guest before the account existed. Without this,
  // /users/me returns an id and no email and that fallback silently finds
  // nothing. Verified: with the permission, a customer token reads its own
  // id+email and gets 403 on eo_orders, eo_products and other projects alike.
  //
  // Create the policy, grant read-own-user, attach it to the role via /access.
  // Roles, policies and folders have NO unique constraint on name, so these
  // must be GET-then-POST — a blind POST silently creates a second copy on
  // every run and the idempotency check would pass while duplicating.

  // ---- file folder for product images ----
  console.log('\nFolder')
  await ensure('/folders', { name: 'Ember & Oak' }, 'folder Ember & Oak')

  // ---- collections ----
  console.log('\nCollections')

  await createCollection('eo_categories', 'category', [
    str('name', { required: true }),
    str('slug', { required: true, unique: true }),
    int('sort_order', { def: 0 }),
    { field: 'date_created', type: 'timestamp',
      meta: { special: ['date-created'], interface: 'datetime', readonly: true, hidden: true },
      schema: {} },
  ])

  await createCollection('eo_products', 'local_cafe', [
    { field: 'category', type: 'uuid', meta: { interface: 'select-dropdown-m2o', required: true }, schema: { is_nullable: false } },
    str('name', { required: true }),
    str('slug', { required: true, unique: true }),
    str('tagline'),
    str('description', { long: true }),
    int('price_cents', { required: true, min: 0 }),
    { field: 'image', type: 'uuid', meta: { special: ['file'], interface: 'file-image' }, schema: { is_nullable: true } },
    { field: 'is_active', type: 'boolean', meta: { interface: 'boolean' }, schema: { default_value: true, is_nullable: false } },
    { field: 'meta', type: 'json', meta: { interface: 'input-code', options: { language: 'json' } }, schema: { is_nullable: true } },
    int('stock_initial', { required: true, min: 0, def: 0 }),
    { field: 'date_created', type: 'timestamp',
      meta: { special: ['date-created'], interface: 'datetime', readonly: true, hidden: true }, schema: {} },
  ])

  await createCollection('eo_orders', 'receipt_long', [
    str('order_number', { required: true, unique: true }),
    { field: 'status', type: 'string',
      meta: {
        interface: 'select-dropdown', required: true,
        options: { choices: [
          { text: 'Open', value: 'open' },
          { text: 'Marked', value: 'marked' },
          { text: 'Canceled', value: 'canceled' },
        ] },
      },
      schema: { default_value: 'open', is_nullable: false } },
    str('customer_name', { required: true }),
    str('email', { required: true }),
    str('street', { required: true }),
    str('zip', { required: true }),
    str('city', { required: true }),
    str('country', { required: true }),
    int('subtotal_cents', { required: true, min: 0 }),
    int('shipping_cents', { required: true, min: 0 }),
    int('total_cents', { required: true, min: 0 }),
    str('cancel_reason'),
    str('cancel_note', { long: true }),
    { field: 'user', type: 'uuid', meta: { interface: 'select-dropdown-m2o' }, schema: { is_nullable: true } },
    { field: 'items', type: 'alias', meta: { special: ['o2m'], interface: 'list-o2m' }, schema: null },
    { field: 'date_created', type: 'timestamp',
      meta: { special: ['date-created'], interface: 'datetime', readonly: true, hidden: true }, schema: {} },
    { field: 'date_updated', type: 'timestamp',
      meta: { special: ['date-updated'], interface: 'datetime', readonly: true, hidden: true }, schema: {} },
  ])

  await createCollection('eo_order_items', 'list', [
    { field: 'order', type: 'uuid', meta: { interface: 'select-dropdown-m2o', required: true }, schema: { is_nullable: false } },
    { field: 'product', type: 'uuid', meta: { interface: 'select-dropdown-m2o' }, schema: { is_nullable: true } },
    str('product_name', { required: true }),
    int('unit_price_cents', { required: true, min: 0 }),
    int('quantity', { required: true, min: 1 }),
  ])

  // ---- relations ----
  // SET NULL on user: deleting an account must orphan order history, never erase it.
  // SET NULL on product: a deleted product must degrade the line to text, not delete it.
  // CASCADE on order: deleting an order takes its lines with it.
  console.log('\nRelations')
  await relate('eo_products', 'category', 'eo_categories', 'NO ACTION')
  await relate('eo_products', 'image', 'directus_files', 'SET NULL')
  await relate('eo_orders', 'user', 'directus_users', 'SET NULL')
  await relate('eo_order_items', 'order', 'eo_orders', 'CASCADE', 'items')
  await relate('eo_order_items', 'product', 'eo_products', 'SET NULL')

  console.log('\nDone.')
}

main().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1) })
```

- [ ] **Step 4: Add the script**

Modify `package.json` scripts:

```json
    "directus:setup": "node --env-file=.env directus/setup.ts",
    "directus:seed": "node --env-file=.env directus/seed.ts"
```

Node 24 is in use (verified), so it runs `.ts` directly and `--env-file` loads `.env`.

- [ ] **Step 5: Run it**

Run: `yarn directus:setup`
Expected: `created` lines for the role, folder, four collections, every field, and five relations. No `FAILED`.

- [ ] **Step 6: Run it again — this is the idempotency check**

Run: `yarn directus:setup`
Expected: every line now reads `exists`, zero `created`, no `FAILED`.

- [ ] **Step 7: Verify the schema landed correctly**

```bash
set -a; . ./.env; set +a
curl -s -H "Authorization: Bearer $DIRECTUS_API_TOKEN" \
  "$DIRECTUS_URL/collections" | grep -o '"collection":"eo_[a-z_]*"' | sort -u
```

Expected: exactly `eo_categories`, `eo_order_items`, `eo_orders`, `eo_products`.

Then confirm the on-delete rules, which are the part most likely to be silently wrong:

```bash
curl -s -H "Authorization: Bearer $DIRECTUS_API_TOKEN" "$DIRECTUS_URL/relations" \
 | tr ',' '\n' | grep -A1 'eo_'
```

Expected: `eo_order_items.order` → CASCADE, `eo_order_items.product` → SET NULL, `eo_orders.user` → SET NULL.

- [ ] **Step 8: Confirm the other projects are untouched**

Run the collections command from Step 7 without the `eo_` filter and confirm `cascade_*`, `project_style`, `*_colors` and `shader_presets` are all still present and unmodified.

---

## Task 5: Seed data file

**Files:**
- Create: `directus/seed-data.ts`

> ⚠️ **The single most important detail in this plan.**
>
> `supabase/migration-004-stock.sql` runs **two** updates. The first sets gross
> stock numbers. The second *subtracts the demo orders' quantities* so the old
> trigger-based invariant held from the start.
>
> Under derived stock the aggregate subtracts those same order lines
> automatically. **`stock_initial` must be the GROSS number from the first
> update — not the value `products.stock` holds in Supabase today**, which is
> already net. Seeding from the live values double-counts every demo order.

- [ ] **Step 1: Transcribe the catalog**

Create `directus/seed-data.ts` exporting `categories` and `products`. Source the fields from the repo rather than from memory:

- `name`, `slug`, `tagline`, `description`, `price_cents` → `supabase/schema.sql`, the `insert into public.products` block
- `meta` → `supabase/migration-002-meta-and-orders.sql`, the `update public.products set meta` block
- `stock_initial` → the table below

```ts
import type { ProductMeta } from '../shared/types/directus'

export const categories = [
  { name: 'Coffee', slug: 'coffee', sort_order: 1 },
  { name: 'Pantry', slug: 'pantry', sort_order: 2 },
  { name: 'Accessories', slug: 'accessories', sort_order: 3 },
]

export interface SeedProduct {
  category_slug: string
  name: string
  slug: string
  tagline: string
  description: string
  price_cents: number
  meta: ProductMeta
  stock_initial: number
  /** Filename in the Supabase product-images bucket. */
  image_file: string
}

export const products: SeedProduct[] = [
  // One full entry showing the exact shape. Transcribe the other eleven the
  // same way, in the order they appear in schema.sql.
  {
    category_slug: 'coffee',
    name: 'Ember Blend – Dark Roast 250g',
    slug: 'ember-blend-dark-roast',
    tagline: 'Smoky, chocolatey, unapologetic.',
    description: 'Our signature dark roast. A blend of Brazilian and Sumatran beans roasted deep into the second crack — notes of dark chocolate, toasted hazelnut and a whisper of smoke. Built for espresso, brave enough for filter.',
    price_cents: 1490,
    meta: { weight_g: 250, meta_line: '250 G · WHOLE BEAN · BLEND · BRAZIL + SUMATRA', roast_pct: 88, flavors: ['Dark chocolate', 'Hazelnut', 'Smoke'] },
    stock_initial: 18,
    image_file: 'ember-blend-dark-roast.jpg',
  },
  // …eleven more
]
```

Copy the strings rather than retyping them. The en dashes (`–` in names, `—` in descriptions) and the `·` separators in `meta_line` are load-bearing for the design and must survive exactly. The apostrophes in `'Your latte''s best friend.'` and `'we won''t judge'` are SQL escaping — they become single apostrophes in TypeScript.

**`stock_initial` values — the gross numbers:**

| slug | stock_initial |
|---|---|
| `ember-blend-dark-roast` | 18 |
| `sunrise-single-origin-ethiopia` | 11 |
| `house-espresso-classic` | 25 |
| `midnight-decaf-swiss-water` | 12 |
| `honey-almond-granola` | 30 |
| `dark-cacao-bar-70` | 0 |
| `oat-milk-syrup-vanilla` | 9 |
| `wildflower-honey` | 3 |
| `ceramic-pour-over-dripper` | 7 |
| `paper-filters-02` | 40 |
| `ember-oak-ceramic-mug` | 15 |
| `glass-carafe-brewer` | 2 |

`image_file` is `<slug>.jpg` for every product — confirm against the bucket listing in Task 7 Step 1 before relying on it.

- [ ] **Step 2: Transcribe the demo orders**

Also export `demoOrders` from the same file, from the `do $$` block in `supabase/migration-002-meta-and-orders.sql`. Subtotals are **not** transcribed — the seed script recomputes them from `price_cents`, exactly as the SQL did, so a price change cannot desync them.

```ts
export interface SeedOrder {
  order_number: string
  customer_name: string
  email: string
  street: string
  zip: string
  city: string
  country: string
  status: 'open' | 'marked' | 'canceled'
  date_created: string
  /** slug:qty */
  items: string[]
}

export const demoOrders: SeedOrder[] = [
  { order_number: 'EO-2026-0841', customer_name: 'Felix Maier', email: 'felix.m@mail.de', street: 'Hauptstraße 12', zip: '79098', city: 'Freiburg', country: 'Germany', status: 'canceled', date_created: '2026-08-11T09:14:00+02:00', items: ['ember-blend-dark-roast:1', 'honey-almond-granola:1', 'dark-cacao-bar-70:1'] },
  { order_number: 'EO-2026-0842', customer_name: 'Sofia Lang', email: 'sofia.lang@web.de', street: 'Gartenweg 3', zip: '79102', city: 'Freiburg', country: 'Germany', status: 'marked', date_created: '2026-08-11T15:40:00+02:00', items: ['ember-blend-dark-roast:1'] },
  { order_number: 'EO-2026-0843', customer_name: 'David Braun', email: 'd.braun@posteo.de', street: 'Mühlenstraße 8', zip: '70173', city: 'Stuttgart', country: 'Germany', status: 'open', date_created: '2026-08-12T08:05:00+02:00', items: ['sunrise-single-origin-ethiopia:2', 'wildflower-honey:1'] },
  { order_number: 'EO-2026-0844', customer_name: 'Anna Schulz', email: 'anna.schulz@mail.de', street: 'Lindenallee 21', zip: '76133', city: 'Karlsruhe', country: 'Germany', status: 'canceled', date_created: '2026-08-12T17:22:00+02:00', items: ['honey-almond-granola:2', 'dark-cacao-bar-70:1'] },
  { order_number: 'EO-2026-0845', customer_name: 'Tom Richter', email: 'tom.richter@gmx.de', street: 'Bergstraße 44', zip: '79539', city: 'Lörrach', country: 'Germany', status: 'marked', date_created: '2026-08-13T10:31:00+02:00', items: ['house-espresso-classic:2', 'paper-filters-02:2', 'oat-milk-syrup-vanilla:1'] },
  { order_number: 'EO-2026-0846', customer_name: 'Marie Keller', email: 'm.keller@web.de', street: 'Am Markt 2', zip: '79098', city: 'Freiburg', country: 'Germany', status: 'marked', date_created: '2026-08-13T14:18:00+02:00', items: ['ceramic-pour-over-dripper:1'] },
  { order_number: 'EO-2026-0847', customer_name: 'Jonas Weber', email: 'jonas.weber@mail.de', street: 'Rebbergweg 17', zip: '79576', city: 'Weil am Rhein', country: 'Germany', status: 'open', date_created: '2026-08-14T07:52:00+02:00', items: ['ember-blend-dark-roast:1', 'sunrise-single-origin-ethiopia:1'] },
  { order_number: 'EO-2026-0848', customer_name: 'Lena Hoffmann', email: 'lena.hoffmann@example.com', street: 'Lindenstraße 24', zip: '79098', city: 'Freiburg', country: 'Germany', status: 'open', date_created: '2026-08-14T11:03:00+02:00', items: ['ember-blend-dark-roast:1', 'sunrise-single-origin-ethiopia:2', 'honey-almond-granola:1'] },
]
```

- [ ] **Step 3: Verify the transcription**

Run: `node -e "const d=require('./directus/seed-data.ts'); console.log(d.products.length, d.categories.length, d.demoOrders.length)"`
Expected: `12 3 8`

Then spot-check one long field survived transcription intact:

Run: `node -e "const d=require('./directus/seed-data.ts'); console.log(d.products.find(p=>p.slug==='sunrise-single-origin-ethiopia').description)"`
Expected: the full Yirgacheffe paragraph, including the en dash and "jasmine, bergamot".

---

## Task 6: Seed categories and products

**Files:**
- Create: `directus/seed.ts`

- [ ] **Step 1: Write the category and product seeding**

Idempotent by `slug` — re-running updates rather than duplicating.

```ts
import { categories, products, demoOrders } from './seed-data'

const URL = (process.env.DIRECTUS_URL || '').replace(/\/$/, '')
const TOKEN = process.env.DIRECTUS_API_TOKEN
if (!URL || !TOKEN) throw new Error('DIRECTUS_URL / DIRECTUS_API_TOKEN missing in env')

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(init.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${body?.errors?.[0]?.message ?? res.statusText}`)
  return body?.data
}

/** Create or update by slug. Returns the row id. */
async function upsertBySlug(collection: string, slug: string, payload: object): Promise<string> {
  const found = await api(`/items/${collection}?filter[slug][_eq]=${encodeURIComponent(slug)}&fields=id&limit=1`)
  if (found?.length) {
    await api(`/items/${collection}/${found[0].id}`, { method: 'PATCH', body: JSON.stringify(payload) })
    return found[0].id
  }
  const created = await api(`/items/${collection}`, { method: 'POST', body: JSON.stringify({ ...payload, slug }) })
  return created.id
}

async function seedCatalog() {
  console.log('Categories')
  const catIds: Record<string, string> = {}
  for (const c of categories) {
    catIds[c.slug] = await upsertBySlug('eo_categories', c.slug, c)
    console.log(`  ${c.slug}`)
  }

  console.log('Products')
  for (const p of products) {
    const { category_slug, image_file, ...rest } = p
    await upsertBySlug('eo_products', p.slug, { ...rest, category: catIds[category_slug] })
    console.log(`  ${p.slug}  stock_initial=${p.stock_initial}`)
  }
}

async function main() {
  await seedCatalog()
  console.log('\nDone.')
}

main().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1) })
```

- [ ] **Step 2: Run it**

Run: `yarn directus:seed`
Expected: 3 category lines, 12 product lines with their `stock_initial`, no `FAILED`.

- [ ] **Step 3: Run it again**

Run: `yarn directus:seed`
Expected: identical output. Then confirm nothing duplicated:

```bash
set -a; . ./.env; set +a
curl -s -H "Authorization: Bearer $DIRECTUS_API_TOKEN" \
  "$DIRECTUS_URL/items/eo_products?aggregate[count]=id"
```

Expected: `12`. Not 24.

---

## Task 7: Migrate product images

**Files:**
- Modify: `directus/seed.ts`

- [ ] **Step 1: List what is actually in the Supabase bucket**

```bash
set -a; . ./.env; set +a
curl -s -X POST "$SUPABASE_URL/storage/v1/object/list/product-images" \
  -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prefix":"","limit":100}' | grep -o '"name":"[^"]*"'
```

Expected: 12 filenames. **Correct `image_file` in `seed-data.ts` if they are not all `<slug>.jpg`.**

- [ ] **Step 2: Add image upload to `directus/seed.ts`**

```ts
const BUCKET = `${(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/public/product-images`

async function folderId(): Promise<string> {
  const found = await api('/folders?filter[name][_eq]=Ember %26 Oak&fields=id&limit=1')
  if (!found?.length) throw new Error('Folder "Ember & Oak" not found — run yarn directus:setup first')
  return found[0].id
}

/** Idempotent by filename_download: skips a product that already has an image. */
async function seedImages() {
  console.log('Images')
  const folder = await folderId()

  for (const p of products) {
    const existing = await api(`/items/eo_products?filter[slug][_eq]=${p.slug}&fields=id,image&limit=1`)
    const row = existing?.[0]
    if (!row) throw new Error(`product ${p.slug} not seeded — run seedCatalog first`)
    if (row.image) { console.log(`  skip     ${p.slug}`); continue }

    const src = await fetch(`${BUCKET}/${p.image_file}`)
    if (!src.ok) throw new Error(`fetch ${p.image_file} → ${src.status}`)
    const blob = await src.blob()

    const form = new FormData()
    form.append('folder', folder)
    form.append('title', p.name)
    form.append('file', blob, p.image_file)

    const file = await api('/files', { method: 'POST', body: form })
    await api(`/items/eo_products/${row.id}`, { method: 'PATCH', body: JSON.stringify({ image: file.id }) })
    console.log(`  uploaded ${p.slug} → ${file.id}`)
  }
}
```

Call `await seedImages()` after `await seedCatalog()` in `main()`.

- [ ] **Step 3: Run and verify**

Run: `yarn directus:seed`
Expected: 12 `uploaded` lines. Run once more — expected: 12 `skip` lines.

```bash
curl -s -H "Authorization: Bearer $DIRECTUS_API_TOKEN" \
  "$DIRECTUS_URL/items/eo_products?filter[image][_null]=true&aggregate[count]=id"
```

Expected: `0` — every product has an image.

- [ ] **Step 4: Make the images publicly readable — ALREADY SATISFIED, do not add**

**Verified 2026-08-18: unnecessary.** The Public policy on this instance already carries `directus_files` read with `permissions: null` — unrestricted, every file — configured by another project long before this migration. `/assets/<id>` returns 200 unauthenticated with no action from us.

A folder-scoped rule would be dead weight: Directus ORs permissions together, so a narrower rule alongside an unrestricted one changes nothing. Skip it.

Two things to know rather than act on:

- **We depend on another project's permission.** If anyone ever scopes that rule down, product images break. The fix then is the rule below — not a panic.
- ⚠️ **Pre-existing, not ours:** the same Public policy also grants `directus_files` **update** with `permissions: null`, so an unauthenticated request can rewrite the metadata of every file on the instance. Raised with the repo owner; out of scope here.

Retained for reference only, should the broad rule ever be removed — add to `directus/setup.ts` after the folder creation and re-run `yarn directus:setup`:

```ts
  console.log('\nPublic file access')
  const publicPolicy = (await api('/policies?filter[name][_eq]=$t:public_label&fields=id&limit=1'))?.[0]
  if (!publicPolicy) throw new Error('Public policy not found')
  const folder = (await api('/folders?filter[name][_eq]=Ember %26 Oak&fields=id&limit=1'))?.[0]
  if (!folder) throw new Error('Folder "Ember & Oak" not found')

  await ensure('/permissions', {
    policy: publicPolicy.id,
    collection: 'directus_files',
    action: 'read',
    fields: ['id', 'filename_download', 'title', 'type', 'width', 'height'],
    permissions: { folder: { _eq: folder.id } },
  }, 'public read on directus_files (Ember & Oak folder only)')
```

- [ ] **Step 5: Verify an image loads without a token**

```bash
set -a; . ./.env; set +a
ID=$(curl -s -H "Authorization: Bearer $DIRECTUS_API_TOKEN" \
  "$DIRECTUS_URL/items/eo_products?filter[slug][_eq]=ember-blend-dark-roast&fields=image&limit=1" \
  | grep -o '"image":"[^"]*"' | cut -d'"' -f4)
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "$DIRECTUS_URL/assets/$ID?width=400&format=webp"
```

Expected: `200 image/webp`. **No Authorization header** — that is the point of the test.

Then confirm a file *outside* the folder is still private (there are none yet, so this passes vacuously; re-check it if other projects add files).

---

## Task 8: Seed the demo orders

**Files:**
- Modify: `directus/seed.ts`

Seeded by **direct insert, never through `/api/orders`** — the order route sends a confirmation mail, and these addresses (`felix.m@mail.de` and friends) are fake. After Task 15 that mail goes to a real SMTP server.

- [ ] **Step 1: Add order seeding**

```ts
import { FREE_SHIPPING_CENTS, SHIPPING_FLAT_CENTS } from '../shared/utils/shop'

async function seedOrders() {
  console.log('Demo orders')
  const catalog: Array<{ id: string; slug: string; name: string; price_cents: number }> =
    await api('/items/eo_products?fields=id,slug,name,price_cents&limit=-1')
  const bySlug = new Map(catalog.map(p => [p.slug, p]))

  for (const o of demoOrders) {
    const existing = await api(`/items/eo_orders?filter[order_number][_eq]=${o.order_number}&fields=id&limit=1`)
    if (existing?.length) { console.log(`  skip   ${o.order_number}`); continue }

    const lines = o.items.map((spec) => {
      const [slug, qty] = spec.split(':')
      const p = bySlug.get(slug!)
      if (!p) throw new Error(`unknown product ${slug} in ${o.order_number}`)
      return { product: p.id, product_name: p.name, unit_price_cents: p.price_cents, quantity: Number(qty) }
    })

    const subtotal = lines.reduce((n, l) => n + l.unit_price_cents * l.quantity, 0)
    const shipping = subtotal >= FREE_SHIPPING_CENTS ? 0 : SHIPPING_FLAT_CENTS

    const { order_number, customer_name, email, street, zip, city, country, status, date_created } = o
    const order = await api('/items/eo_orders', {
      method: 'POST',
      body: JSON.stringify({
        order_number, customer_name, email, street, zip, city, country, status, date_created,
        subtotal_cents: subtotal, shipping_cents: shipping, total_cents: subtotal + shipping,
      }),
    })

    await api('/items/eo_order_items', {
      method: 'POST',
      body: JSON.stringify(lines.map(l => ({ ...l, order: order.id }))),
    })
    console.log(`  create ${o.order_number}  ${lines.length} lines  ${(subtotal + shipping) / 100}€`)
  }
}
```

Call `await seedOrders()` last in `main()`.

> `date_created` carries `special: ['date-created']`, which makes Directus stamp
> it on insert and may ignore the supplied value. If the verification below
> shows today's date instead of August 11–14, PATCH each order's `date_created`
> in a second pass immediately after creation — the special field blocks it only
> on create.

- [ ] **Step 2: Run and verify**

Run: `yarn directus:seed`
Expected: 8 `create` lines. Re-run — expected: 8 `skip` lines.

- [ ] **Step 3: Verify derived stock produces the intended spread**

This is the real test of Task 5's gross-vs-net warning.

```bash
set -a; . ./.env; set +a
curl -s -G -H "Authorization: Bearer $DIRECTUS_API_TOKEN" \
  "$DIRECTUS_URL/items/eo_order_items" \
  --data-urlencode "aggregate[sum]=quantity" \
  --data-urlencode "groupBy=product" \
  --data-urlencode "filter[order][status][_neq]=canceled"
```

Cross-check by hand against the gross numbers. Expected availability:

| slug | initial | held | available | badge |
|---|---|---|---|---|
| `ember-blend-dark-roast` | 18 | 3 | 15 | ok |
| `sunrise-single-origin-ethiopia` | 11 | 5 | 6 | ok |
| `wildflower-honey` | 3 | 1 | 2 | **low** |
| `glass-carafe-brewer` | 2 | 0 | 2 | **low** |
| `dark-cacao-bar-70` | 0 | 0 | 0 | **out** |

If `dark-cacao-bar-70` is anything but 0, or `wildflower-honey` is 1 rather than 2, the gross/net mistake from Task 5 was made — fix `stock_initial`, do not adjust the orders.

---

## Task 9: Stock module

**Files:**
- Create: `server/utils/stock.ts`

- [ ] **Step 1: Write it**

```ts
import { aggregate, readItems } from '@directus/sdk'

/**
 * Availability, derived — never stored.
 *
 *   available(p) = stock_initial(p) − Σ quantity over order lines
 *                  whose order is not canceled
 *
 * This is why checkout is insert-only and cancellation needs no give-back:
 * a canceled order simply stops counting. There is no counter to decrement
 * and therefore no lost update to lose.
 *
 * Directus cannot create triggers or CHECK constraints, so unlike the old
 * Supabase design this is NOT a database guarantee — see withStockLock().
 */
export async function heldByOpenOrders(): Promise<Map<string, number>> {
  const rows = await directus().request(
    aggregate('eo_order_items', {
      aggregate: { sum: 'quantity' },
      groupBy: ['product'],
      query: { filter: { order: { status: { _neq: 'canceled' } } } },
    }),
  ) as Array<{ product: string | null; sum: { quantity: string | number | null } }>

  const held = new Map<string, number>()
  for (const r of rows) {
    if (!r.product) continue // line whose product was deleted
    held.set(r.product, Number(r.sum?.quantity ?? 0))
  }
  return held
}

/** stock_available for one set of product ids. */
export async function availabilityFor(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map()
  const [held, rows] = await Promise.all([
    heldByOpenOrders(),
    directus().request(readItems('eo_products', {
      fields: ['id', 'stock_initial'],
      filter: { id: { _in: ids } },
      limit: -1,
    })),
  ])
  return new Map(rows.map(p => [p.id, p.stock_initial - (held.get(p.id) ?? 0)]))
}

/**
 * Serialises the read-check-insert sequence.
 *
 * Deriving stock removes the lost update but not the check-then-insert window:
 * two checkouts can both compute "1 available" and both insert. This closes it.
 *
 * CORRECT FOR A SINGLE NITRO PROCESS, AND ONLY FOR THAT. It is not a database
 * guarantee and must not be described as one. If this app is ever run across
 * multiple instances, get MySQL credentials and add a trigger-based guard.
 */
let tail: Promise<unknown> = Promise.resolve()

export function withStockLock<T>(fn: () => Promise<T>): Promise<T> {
  // Chain onto the tail, and make the tail immune to this call's rejection —
  // otherwise one failed checkout would poison every later one.
  const run = tail.then(fn, fn)
  tail = run.then(() => undefined, () => undefined)
  return run
}
```

- [ ] **Step 2: Verify the aggregate call works through the SDK**

The REST shape is verified against the live instance; the SDK wrapper is not. Create a throwaway route `server/api/dev/stock-check.get.ts`:

```ts
export default defineEventHandler(async () => {
  return Object.fromEntries(await availabilityFor(
    (await directus().request(readItems('eo_products', { fields: ['id'], limit: -1 })))
      .map(p => p.id),
  ))
})
```

Add `import { readItems } from '@directus/sdk'` at the top.

Run: `yarn dev`, then `curl -s localhost:3000/api/dev/stock-check`
Expected: 12 id→number pairs matching the table in Task 8 Step 3.

**If the SDK's `aggregate()` rejects the `groupBy`/`query` shape**, fall back to the raw REST call, which is verified working — replace the body of `heldByOpenOrders()` with a `$fetch` to `/items/eo_order_items?aggregate[sum]=quantity&groupBy=product&filter[order][status][_neq]=canceled`.

- [ ] **Step 3: Delete the throwaway route**

Run: `rm server/api/dev/stock-check.get.ts`

---

## Task 10: Catalog route and auth

**Files:**
- Create: `server/api/catalog.get.ts`
- Rewrite: `server/utils/auth.ts`
- Create: `server/api/auth/{login,logout,register,me}.ts`

- [ ] **Step 1: Write the catalog route**

`/api/catalog` exists because derived stock needs an aggregate over `eo_order_items`, and order lines can never be public. This is the reason the browser no longer reads the datastore directly the way RLS allowed.

```ts
import { readItems } from '@directus/sdk'

export default defineEventHandler(async () => {
  const db = directus()
  const [categories, products, held] = await Promise.all([
    db.request(readItems('eo_categories', { fields: ['*'], sort: ['sort_order'], limit: -1 })),
    db.request(readItems('eo_products', {
      fields: ['*', { category: ['id', 'name', 'slug'] }],
      filter: { is_active: { _eq: true } },
      sort: ['date_created'],
      limit: -1,
    })),
    heldByOpenOrders(),
  ])

  return {
    categories,
    products: products.map(p => ({
      ...p,
      stock_available: p.stock_initial - (held.get(p.id) ?? 0),
    })),
  }
})
```

- [ ] **Step 2: Rewrite `server/utils/auth.ts`**

All three functions keep their exact signatures, so every caller stays untouched. This is the only gate — `useProfile()` on the client decides what to render, never what is allowed.

```ts
import type { H3Event } from 'h3'
import type { SessionUser } from '../../shared/types/directus'

const AT = 'eo_at'   // access token
const RT = 'eo_rt'   // refresh token

interface DirectusTokens { access_token: string; refresh_token: string; expires: number }

export function setSessionCookies(event: H3Event, t: DirectusTokens) {
  const secure = !import.meta.dev
  setCookie(event, AT, t.access_token, {
    httpOnly: true, secure, sameSite: 'lax', path: '/',
    maxAge: Math.floor(t.expires / 1000),
  })
  setCookie(event, RT, t.refresh_token, {
    httpOnly: true, secure, sameSite: 'lax', path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
}

export function clearSessionCookies(event: H3Event) {
  deleteCookie(event, AT, { path: '/' })
  deleteCookie(event, RT, { path: '/' })
}

export function refreshTokenCookie(event: H3Event) {
  return getCookie(event, RT)
}

async function meWith(token: string): Promise<SessionUser | null> {
  try {
    const [me, globals] = await Promise.all([
      $fetch<{ data: { id: string; email: string | null } }>(
        `${directusUrl()}/users/me?fields=id,email`,
        { headers: { Authorization: `Bearer ${token}` } }),
      $fetch<{ data: { admin_access: boolean } }>(
        `${directusUrl()}/policies/me/globals`,
        { headers: { Authorization: `Bearer ${token}` } }),
    ])
    return { id: me.data.id, email: me.data.email ?? null, isAdmin: !!globals.data.admin_access }
  } catch {
    return null
  }
}

/**
 * The signed-in user, or null. Never throws — for routes where a session is
 * optional (guest checkout).
 *
 * Directus rotates refresh tokens on use, so this only refreshes when the
 * access token is actually gone, and treats a failed refresh as "signed out"
 * rather than as an error.
 */
export async function currentUser(event: H3Event): Promise<SessionUser | null> {
  const access = getCookie(event, AT)
  if (access) {
    const user = await meWith(access)
    if (user) return user
  }

  const refresh = getCookie(event, RT)
  if (!refresh) return null

  try {
    const res = await $fetch<{ data: DirectusTokens }>(`${directusUrl()}/auth/refresh`, {
      method: 'POST',
      body: { refresh_token: refresh, mode: 'json' },
    })
    setSessionCookies(event, res.data)
    return await meWith(res.data.access_token)
  } catch {
    clearSessionCookies(event)
    return null
  }
}

/** Any signed-in user, or 401. */
export async function requireUser(event: H3Event): Promise<SessionUser> {
  const user = await currentUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Not signed in' })
  return user
}

/**
 * A signed-in admin, or 401/403. Any Directus user with admin_access counts,
 * which includes every Administrator on this shared instance.
 */
export async function requireAdmin(event: H3Event): Promise<SessionUser> {
  const user = await requireUser(event)
  if (!user.isAdmin) throw createError({ statusCode: 403, statusMessage: 'Admins only' })
  return user
}
```

- [ ] **Step 3: Write the four auth routes**

> ⚠️ **Corrected 2026-08-18 after this bit up.** The draft below originally ended
> login and register with `setSessionCookies(event, …)` then
> `return await currentUser(event)`. **That always returns `null`.** `setCookie`
> writes a *response* header while `getCookie` reads the *request*, so within
> the same request the cookie just set is invisible; `currentUser()` falls
> through to the equally invisible refresh cookie and returns null. Both routes
> answered HTTP 204 with an empty body instead of the user.
>
> The fix: `auth.ts` exports `userForToken(token)` (the former private
> `meWith()`, unchanged otherwise), and login/register return
> `await userForToken(res.data.access_token)` — the token they already hold in
> hand. `currentUser()` still uses it internally and `me.get.ts` is unaffected.
>
> Related: **a `null` return serialises as HTTP 204 with an empty body**, not a
> literal `null`. `/api/auth/me` does this for a signed-out visitor. `ofetch`
> turns it into `null` client-side, so Task 12 is fine — but do not write client
> code that expects a literal `null` body.

`server/api/auth/login.post.ts`:

```ts
export default defineEventHandler(async (event) => {
  const { email, password } = await readBody<{ email?: string; password?: string }>(event)
  if (!email || !password) throw createError({ statusCode: 400, statusMessage: 'Email and password required' })

  let res: { data: { access_token: string; refresh_token: string; expires: number } }
  try {
    res = await $fetch(`${directusUrl()}/auth/login`, {
      method: 'POST',
      body: { email, password, mode: 'json' },
    })
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Wrong email or password' })
  }

  setSessionCookies(event, res.data)
  return await currentUser(event)
})
```

`server/api/auth/logout.post.ts`:

```ts
export default defineEventHandler(async (event) => {
  const refresh = refreshTokenCookie(event)
  clearSessionCookies(event)
  if (refresh) {
    // Best effort — the cookies are already gone, so the person is signed out
    // regardless of whether Directus accepts this.
    await $fetch(`${directusUrl()}/auth/logout`, {
      method: 'POST', body: { refresh_token: refresh, mode: 'json' },
    }).catch(() => {})
  }
  return { ok: true }
})
```

`server/api/auth/register.post.ts` — creates the user with the **Ember & Oak Customer** role via the admin token, deliberately not Directus's `/users/register`, whose `public_registration_role` is a single global setting the tour-booking project depends on:

```ts
import { readRoles, createUser } from '@directus/sdk'

export default defineEventHandler(async (event) => {
  const { email, password } = await readBody<{ email?: string; password?: string }>(event)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid email address' })
  }
  if (!password || password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters' })
  }

  const roles = await directus().request(readRoles({
    filter: { name: { _eq: 'Ember & Oak Customer' } }, fields: ['id'], limit: 1,
  }))
  if (!roles.length) throw createError({ statusCode: 500, statusMessage: 'Customer role missing — run yarn directus:setup' })

  try {
    await directus().request(createUser({ email, password, role: roles[0]!.id, status: 'active' }))
  } catch (e: any) {
    const msg = String(e?.errors?.[0]?.message ?? e?.message ?? '')
    if (/unique|already/i.test(msg)) {
      throw createError({ statusCode: 409, statusMessage: 'An account with that email already exists' })
    }
    throw createError({ statusCode: 500, statusMessage: 'Could not create the account' })
  }

  const res = await $fetch<{ data: { access_token: string; refresh_token: string; expires: number } }>(
    `${directusUrl()}/auth/login`, { method: 'POST', body: { email, password, mode: 'json' } })
  setSessionCookies(event, res.data)
  return await currentUser(event)
})
```

`server/api/auth/me.get.ts`:

```ts
export default defineEventHandler(async event => await currentUser(event))
```

- [ ] **Step 4: Verify the catalog route**

Run: `yarn dev`, then

```bash
curl -s localhost:3000/api/catalog | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);
console.log('categories', j.categories.length, '| products', j.products.length);
for (const p of j.products) if (['dark-cacao-bar-70','wildflower-honey','glass-carafe-brewer'].includes(p.slug))
  console.log(' ', p.slug, 'available=' + p.stock_available, 'image=' + !!p.image);
})"
```

Expected: `categories 3 | products 12`, and `dark-cacao-bar-70 available=0`, `wildflower-honey available=2`, `glass-carafe-brewer available=2`, each with `image=true`.

- [ ] **Step 5: Verify auth end to end**

```bash
# admin login with the existing Directus account
curl -s -c /tmp/eo.jar -X POST localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"schmidt@rhowerk.de","password":"<your directus password>"}'
```

Expected: `{"id":"ec5f2aae-…","email":"schmidt@rhowerk.de","isAdmin":true}`

```bash
curl -s -b /tmp/eo.jar localhost:3000/api/auth/me
curl -s localhost:3000/api/auth/me
```

Expected: the same user with the cookie jar; `null` without it.

```bash
curl -s -X POST localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"test-customer@example.com","password":"hunter2hunter2"}'
```

Expected: `{"id":"…","email":"test-customer@example.com","isAdmin":false}` — **`isAdmin` must be false.** Repeating the call must return 409, not 500.

---

## Task 11: Order routes

**Files:**
- Rewrite: `server/api/orders.post.ts`, `server/api/admin/orders.get.ts`, `server/api/admin/orders/[id].patch.ts`, `server/api/account/orders.get.ts`

- [ ] **Step 1: Rewrite `server/api/orders.post.ts`**

Keep the existing validation block, the `FREE_SHIPPING_CENTS` import and the fire-and-forget mail exactly as they are. What changes is everything between: the datastore, the stock check, and order-number generation — all inside the lock.

```ts
import { readItems, createItem, createItems, deleteItem } from '@directus/sdk'
import { FREE_SHIPPING_CENTS, SHIPPING_FLAT_CENTS } from '../../shared/utils/shop'
import { sendOrderConfirmation } from '../utils/email/confirmation'

interface OrderPayload {
  customer: { firstName: string; lastName: string; email: string; street: string; zip: string; city: string; country: string }
  items: { productId: string; qty: number }[]
}

/** EO-2026-0849. Called inside the stock lock, so the read-max is safe. */
async function nextOrderNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `EO-${year}-`
  const last = await directus().request(readItems('eo_orders', {
    fields: ['order_number'],
    filter: { order_number: { _starts_with: prefix } },
    sort: ['-order_number'],
    limit: 1,
  }))
  const n = last.length ? Number(last[0]!.order_number.slice(prefix.length)) + 1 : 841
  return `${prefix}${String(n).padStart(4, '0')}`
}

export default defineEventHandler(async (event) => {
  const body = await readBody<OrderPayload>(event)

  // ---- validate payload (unchanged) ----
  const c = body?.customer
  const required = ['firstName', 'lastName', 'email', 'street', 'zip', 'city', 'country'] as const
  if (!c || required.some(k => typeof c[k] !== 'string' || !c[k].trim())) {
    throw createError({ statusCode: 400, statusMessage: 'Missing customer fields' })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid email address' })
  }
  const items = body?.items
  if (!Array.isArray(items) || items.length === 0 ||
    items.some(i => typeof i.productId !== 'string' || !Number.isInteger(i.qty) || i.qty < 1 || i.qty > 99)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid cart items' })
  }

  const db = directus()
  // Optional — guest checkout stays supported. currentUser() never throws.
  const user = await currentUser(event)

  // ---- price everything server-side from the live catalog ----
  const ids = [...new Set(items.map(i => i.productId))]
  const products = await db.request(readItems('eo_products', {
    fields: ['id', 'name', 'price_cents', 'slug', 'image'],
    filter: { id: { _in: ids } },
    limit: -1,
  }))
  if (products.length !== ids.length) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown product in cart' })
  }

  const lines = items.map((i) => {
    const p = products.find(x => x.id === i.productId)!
    return { product: p.id, product_name: p.name, unit_price_cents: p.price_cents, quantity: i.qty }
  })
  const subtotal = lines.reduce((n, l) => n + l.unit_price_cents * l.quantity, 0)
  const shipping = subtotal >= FREE_SHIPPING_CENTS ? 0 : SHIPPING_FLAT_CENTS
  const total = subtotal + shipping

  // ---- everything that must not race, in one critical section ----
  const order = await withStockLock(async () => {
    const avail = await availabilityFor(ids)
    const short = lines
      .map(l => ({ name: l.product_name, want: l.quantity, have: avail.get(l.product) ?? 0 }))
      .filter(s => s.have < s.want)

    if (short.length) {
      throw createError({
        statusCode: 400,
        statusMessage: short
          .map(s => s.have === 0 ? `${s.name} is out of stock` : `${s.name} — only ${s.have} left`)
          .join('; '),
      })
    }

    const created = await db.request(createItem('eo_orders', {
      order_number: await nextOrderNumber(),
      customer_name: `${c.firstName.trim()} ${c.lastName.trim()}`,
      email: c.email.trim(),
      street: c.street.trim(),
      zip: c.zip.trim(),
      city: c.city.trim(),
      country: c.country.trim(),
      user: user?.id ?? null,
      subtotal_cents: subtotal,
      shipping_cents: shipping,
      total_cents: total,
    }))

    try {
      await db.request(createItems('eo_order_items', lines.map(l => ({ ...l, order: created.id }))))
    } catch (e) {
      // Directus does not wrap these two calls in a transaction, so an orphan
      // order is possible. Clean it up rather than leaving a phantom.
      await db.request(deleteItem('eo_orders', created.id)).catch(() => {})
      throw e
    }
    return created
  })

  // Display fields for the confirmation page's thumbnails and links. Shaped
  // like the expanded relation /api/account/orders returns, so both pages
  // render the same way. Name and price stay snapshotted on the line itself.
  const displayLines = lines.map((l) => {
    const p = products.find(x => x.id === l.product)!
    return { ...l, product: { id: p.id, slug: p.slug, image: p.image } }
  })

  // Fire-and-forget: a mail failure must never fail an order that is already stored
  const full = { ...order, items: displayLines }
  event.waitUntil(
    sendOrderConfirmation(full as any).catch(err =>
      console.error(`[mail] confirmation for ${order.order_number} failed:`, err)),
  )

  return full
})
```

- [ ] **Step 2: Rewrite `server/api/admin/orders.get.ts`**

```ts
import { readItems } from '@directus/sdk'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return await directus().request(readItems('eo_orders', {
    fields: ['*', { items: ['*', { product: ['id', 'slug', 'image'] }] }],
    sort: ['-date_created'],
    limit: -1,
  }))
})
```

- [ ] **Step 3: Rewrite `server/api/admin/orders/[id].patch.ts`**

Keep the whole validation block and the mail block verbatim. Two things change: the datastore, and the 409 — which no longer comes from a Postgres error code but from an explicit availability check, because reopening a canceled order re-takes stock.

Replace everything from `const db = supabaseAdmin()` to the end of the error handling with:

```ts
  const db = directus()

  // Read the status we are coming from, so the mail only fires on a real transition
  const before = await db.request(readItem('eo_orders', id, { fields: ['status'] }))
    .catch(() => null)
  if (!before) throw createError({ statusCode: 404, statusMessage: 'Order not found' })

  // The reason columns belong to a cancellation and are cleared by any other status
  const patch = body.status === 'canceled'
    ? { status: body.status, cancel_reason: reason, cancel_note: note }
    : { status: body.status, cancel_reason: null, cancel_note: null }

  const data = await withStockLock(async () => {
    // Leaving `canceled` re-takes this order's stock. Under derived stock that
    // is not a constraint violation but a silent oversell, so check first.
    if (before.status === 'canceled' && body.status !== 'canceled') {
      const lines = await db.request(readItems('eo_order_items', {
        fields: ['product', 'quantity'],
        filter: { order: { _eq: id } },
        limit: -1,
      }))
      const ids = [...new Set(lines.map(l => l.product).filter(Boolean))] as string[]
      const avail = await availabilityFor(ids)
      const short = ids.some((pid) => {
        const want = lines.filter(l => l.product === pid).reduce((n, l) => n + l.quantity, 0)
        return (avail.get(pid) ?? 0) < want
      })
      if (short) {
        throw createError({
          statusCode: 409,
          statusMessage: 'Cannot reopen this order — its items are no longer in stock.',
        })
      }
    }

    await db.request(updateItem('eo_orders', id, patch))
    return await db.request(readItem('eo_orders', id, {
      fields: ['*', { items: ['*', { product: ['id', 'slug', 'image'] }] }],
    }))
  })
```

Add to the imports: `import { readItem, readItems, updateItem } from '@directus/sdk'`.

- [ ] **Step 4: Rewrite `server/api/account/orders.get.ts`**

Still two queries merged, for the reason the original comment gives.

```ts
import { readItems } from '@directus/sdk'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = directus()
  const fields = ['*', { items: ['*', { product: ['id', 'slug', 'image'] }] }] as const

  // Two queries rather than one _or filter, matching the original reasoning:
  // keep the email match a plain equality rather than something assembled by
  // string concatenation.
  const [byUser, byEmail] = await Promise.all([
    db.request(readItems('eo_orders', { fields: fields as any, filter: { user: { _eq: user.id } }, limit: -1 })),
    user.email
      ? db.request(readItems('eo_orders', { fields: fields as any, filter: { email: { _eq: user.email } }, limit: -1 }))
      : Promise.resolve([]),
  ])

  const merged = new Map<string, any>()
  for (const order of [...byUser, ...byEmail]) merged.set(order.id, order)

  return [...merged.values()].sort(
    (a, b) => new Date(b.date_created).getTime() - new Date(a.date_created).getTime(),
  )
})
```

- [ ] **Step 5: Verify the admin list**

```bash
curl -s -b /tmp/eo.jar localhost:3000/api/admin/orders | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);
console.log(j.length, 'orders'); console.log(j[0].order_number, j[0].status, j[0].items.length, 'lines');})"
```

Expected: `8 orders`, and the newest is `EO-2026-0848 open 3 lines`.

Without the cookie jar: expected `401`.

- [ ] **Step 6: Verify the reopen 409**

`dark-cacao-bar-70` has `stock_initial: 0`, and orders 0841 and 0844 (both canceled) contain it. Reopening either must fail:

```bash
ID=$(curl -s -b /tmp/eo.jar localhost:3000/api/admin/orders \
 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
   console.log(JSON.parse(s).find(o=>o.order_number==='EO-2026-0844').id)})")
curl -s -b /tmp/eo.jar -X PATCH "localhost:3000/api/admin/orders/$ID" \
  -H 'Content-Type: application/json' -d '{"status":"open"}'
```

Expected: HTTP 409, `"Cannot reopen this order — its items are no longer in stock."`

This is the single most important behavioural check in the plan — it proves the invariant survived the move off database triggers.

---

## Task 12: App layer

**Files:**
- Rewrite: `app/composables/{useShop,useProfile}.ts`, `app/middleware/*.ts`
- Modify: `app/pages/{login,register,account,admin}.vue`, `app/components/{AccountMenu,StoreHeader}.vue`

- [ ] **Step 1: `app/composables/useShop.ts`**

Keep `badgeLabel()` exactly as it is. Replace `useCatalog()`:

```ts
/** Catalog: categories + active products with derived availability, fetched once */
export function useCatalog() {
  return useFetch('/api/catalog', { key: 'catalog' })
}
```

- [ ] **Step 2: `app/composables/useProfile.ts`**

`loadFor(id)` is **dropped** — it existed only because Supabase's reactive user ref lagged behind `signInWithPassword()`, and `/api/auth/login` returns the user directly.

```ts
import type { SessionUser } from '~~/shared/types/directus'

/**
 * The signed-in person. For UI only: which menu items to render, where to send
 * someone after login. It is NEVER the gate — requireAdmin() in
 * server/utils/auth.ts is the real protection.
 */
export function useProfile() {
  const profile = useState<SessionUser | null>('profile', () => null)

  async function refresh(): Promise<SessionUser | null> {
    profile.value = await $fetch<SessionUser | null>('/api/auth/me')
    return profile.value
  }

  async function signOut() {
    await $fetch('/api/auth/logout', { method: 'POST' })
    profile.value = null
    await navigateTo('/')
  }

  const isAdmin = computed(() => profile.value?.isAdmin === true)
  const role = computed(() => (profile.value ? (isAdmin.value ? 'admin' : 'customer') : null))
  /** Where this person belongs after signing in. */
  const landingPath = computed(() => (isAdmin.value ? '/admin' : '/account'))

  return { profile, role, isAdmin, landingPath, refresh, signOut }
}
```

- [ ] **Step 3: `app/plugins/profile.client.ts`**

There is no reactive user ref any more — the cookie is the session, and `/api/auth/me` is the only reader. The whole plugin becomes:

```ts
export default defineNuxtPlugin(async () => {
  const { profile, refresh } = useProfile()
  if (!profile.value) await refresh()
})
```

- [ ] **Step 4: The three middleware files**

Behaviour is unchanged and deliberate. Each must `await refresh()` when `profile.value` is null, because middleware can run before the plugin on a hard load.

`app/middleware/auth.ts`:

```ts
export default defineNuxtRouteMiddleware(async () => {
  const { profile, refresh } = useProfile()
  if (!profile.value) await refresh()
  if (!profile.value) return navigateTo('/login')
})
```

`app/middleware/admin.ts` — redirects to `/`, **deliberately not `/login`**, so the dashboard is not advertised to people who should not know it exists:

```ts
export default defineNuxtRouteMiddleware(async () => {
  const { profile, isAdmin, refresh } = useProfile()
  if (!profile.value) await refresh()
  if (!isAdmin.value) return navigateTo('/')
})
```

`app/middleware/redirect-if-signed-in.ts` — on `/login` and `/register`, bounces before the form paints:

```ts
export default defineNuxtRouteMiddleware(async () => {
  const { profile, landingPath, refresh } = useProfile()
  if (!profile.value) await refresh()
  if (profile.value) return navigateTo(landingPath.value)
})
```

- [ ] **Step 5: `login.vue` and `register.vue`**

Read each file first — keep its existing markup, loading state and error rendering. Only the submit handler changes. `login.vue`:

```ts
const { profile, landingPath } = useProfile()
const error = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  busy.value = true
  try {
    profile.value = await $fetch('/api/auth/login', {
      method: 'POST',
      body: { email: email.value, password: password.value },
    })
    await navigateTo(landingPath.value)
  } catch (e: any) {
    // e.data.statusMessage, NOT e.statusMessage — the latter is the HTTP reason
    // phrase, which h3 strips of non-ASCII characters.
    error.value = e.data?.statusMessage ?? 'Something went wrong'
  } finally {
    busy.value = false
  }
}
```

`register.vue` is identical apart from posting to `/api/auth/register`. Its 409 ("An account with that email already exists") surfaces through the same `e.data.statusMessage` path.

- [ ] **Step 6: Sign-out call sites**

`AccountMenu.vue`, `StoreHeader.vue`, `account.vue` and `admin.vue` each call `supabase.auth.signOut()`. Replace all four with `signOut()` from `useProfile()`.

- [ ] **Step 7: Verify in the browser**

Run `yarn dev` and check:
- `/` and `/shop` render the catalog with images and stock badges
- `/login` with your Directus account lands on `/admin`
- `/register` with a fresh address lands on `/account`
- `/admin` while signed out redirects to `/`, **not** `/login`
- sign out returns you to `/`

---

## Task 13: Rename pass and Supabase removal

**Files:**
- Modify: `app/pages/{index,shop,cart,checkout,confirmation}.vue`, `app/pages/products/[slug].vue`, `app/pages/{account,admin}.vue`, `app/components/{ProductCard,BrandMark}.vue`, `server/utils/email/{confirmation,shipped,canceled}.ts`, `app/types/shop.ts`, `nuxt.config.ts`
- Delete: `server/utils/supabaseAdmin.ts`, `app/types/database.types.ts`

- [ ] **Step 1: Apply the rename map**

Read each file and apply. Do **not** blind-`sed` — `image` and `product` are common words.

| from | to |
|---|---|
| `product.image_url` | `assetUrl(base, product.image, { width: …, format: 'webp' })` |
| `product.stock` | `product.stock_available` |
| `product.categories` | `product.category` |
| `product.category_id` | `product.category` |
| `order.created_at` | `order.date_created` |
| `order.updated_at` | `order.date_updated` |
| `order.user_id` | `order.user` |
| `order.order_items` | `order.items` |
| `item.product_id` | `item.product` |
| `item.products?.slug` | `item.product?.slug` |
| `item.products?.image_url` | `assetUrl(base, item.product?.image, …)` |

`base` is `useRuntimeConfig().public.directusUrl` in `app/`, and `directusUrl()` in `server/`.

Every image and link stays behind `v-if="item.product?.slug"` so a deleted product still degrades to text.

- [ ] **Step 2: Reduce `app/types/shop.ts`**

Delete `Category`, `Product`, `OrderItem`, `Order`, `OrderStatus`, `Profile`, `UserRole` — they now live in `shared/types/directus.ts`. Keep only `CartItem`. Move `ProductMeta` out (it is already in the new file) and update `app/stores/cart.ts`'s import if it referenced anything removed.

- [ ] **Step 3: Remove Supabase**

```bash
rm server/utils/supabaseAdmin.ts app/types/database.types.ts
yarn remove @nuxtjs/supabase @supabase/supabase-js
```

In `nuxt.config.ts`, remove `'@nuxtjs/supabase'` from `modules` and delete the whole `supabase: { redirect: false }` block.

- [ ] **Step 4: Confirm nothing still references Supabase**

```bash
grep -rn "supabase\|Supabase" app/ server/ shared/ nuxt.config.ts
```

Expected: only *explanatory comments*, no code. Two survive deliberately and should stay — `catalog.get.ts` and `stock.ts` each explain why the design differs from the Supabase original, which is exactly the context a future reader needs. What must not appear is any import, config key, dependency or API call. Hits in `supabase/*.sql`, `CLAUDE.md`, `README.md` and `docs/` are expected — those are the record of the old system.

- [ ] **Step 5: Typecheck**

```bash
yarn dev   # once, to regenerate .nuxt/tsconfig.json, then stop it
npx --yes -p vue-tsc@2.2.10 -p typescript@5.8.3 vue-tsc --noEmit -p .nuxt/tsconfig.json
echo "exit: $?"
```

Expected: `exit: 0` with no diagnostics above it. **A crashed run also prints nothing — confirm you saw the command take a few seconds and exit 0, not error out.** Fix every reported error before continuing; this is the only mechanical check that a rename was missed.

---

## Task 14: Mail to the company SMTP server

**Files:**
- Modify: `.env`, `.env.example`

`server/utils/mailer.ts` is entirely driven by `MAIL_*` env vars, so this is a configuration change with **no code change**. Do not add `EMAIL_*` support to `mailer.ts`.

- [ ] **Step 1: Move the values**

`.env` currently holds `EMAIL_HOST=mail.agenturserver.de`, `EMAIL_ADDRESS=contact@rholing.de` and `EMAIL_SECRET`, and **nothing reads any of them** — they are a trap that makes `.env` look configured. Move those values into the keys the transport actually reads, and delete the `EMAIL_*` lines:

```
MAIL_HOST=mail.agenturserver.de
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=contact@rholing.de
MAIL_PASS=<the EMAIL_SECRET value>
MAIL_FROM="Ember & Oak <contact@rholing.de>"
```

Confirm the port and TLS mode against the provider — 587/STARTTLS (`MAIL_SECURE=false`) or 465/implicit TLS (`MAIL_SECURE=true`).

- [ ] **Step 2: Update `.env.example`**

Remove `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SECRET_KEY` and `DATABASE_URL`. Remove the four `EMAIL_*` keys. Keep `DIRECTUS_URL` and `DIRECTUS_API_TOKEN`, and document each `MAIL_*` key with a comment saying which provider it points at.

- [ ] **Step 3: Verify a template still renders**

Run: `curl -s "localhost:3000/api/dev/preview-mail?template=confirmation" | head -20`
Expected: HTML. Repeat for `shipped` and `canceled`. This route is dev-only and 404s in production.

- [ ] **Step 4: Send one real mail**

> ⚠️ Mail now reaches **real inboxes** — Mailpit is no longer catching anything.
> Use **your own address** for this.

Place an order through `/checkout` with your own email and confirm the confirmation mail arrives. Then mark it shipped from `/admin` and confirm the shipped mail arrives.

---

## Task 15: Documentation

**Files:**
- Modify: `CLAUDE.md`, `README.md`

- [ ] **Step 1: Rewrite the CLAUDE.md sections that are now wrong**

Every one of these currently describes Supabase as the live system:

- **Project → Stack:** hosted Supabase → self-hosted Directus 11.6.1 (MySQL) at `directuscon.axtlust.de`
- **Project → Data:** replace the five hand-run SQL files with `yarn directus:setup` and `yarn directus:seed`, and note they are idempotent
- **Directus migration — in progress:** delete it, or replace with a short "migrated on 2026-08-18, see the spec" pointer. **The whole "The thing most likely to go wrong" section is obsolete** — it plans a trigger port that turned out to be impossible.
- **Stock — read before touching orders:** rewrite entirely. The invariant is the same sentence — *stock is held while an order is not canceled* — but the mechanism is now derived availability plus an in-process lock, and the "do not decrement stock in TypeScript" rule is replaced by **"stock_initial is the only stored stock value; never write an availability number back to the database."** Note that hand-editing order lines is now safe, where it used to corrupt the invariant.
- **Auth and roles:** replace the Supabase JWT-claims section. **Delete the `sub`-vs-`id` trap entirely** — it does not exist on Directus.
- **Mail:** Mailpit → company SMTP. Delete the `EMAIL_*` trap warning; those keys are gone.
- **Conventions:** delete the `database.types.ts` regeneration step. Keep the pinned `vue-tsc` command — it matters more now, not less.
- **Gotchas:** keep all four; they are all still true.

- [ ] **Step 2: Update the README**

Replace the Supabase setup and "Local mail" sections with the Directus setup (`yarn directus:setup`, `yarn directus:seed`) and the new `MAIL_*` configuration. Update "Setting up on a new machine" — the second PC now needs only `.env` plus `yarn install`, since the schema lives on the shared instance.

- [ ] **Step 3: Final verification pass**

Work through §9 of the spec end to end on a fresh `yarn dev`:

- [ ] `yarn directus:setup` and `yarn directus:seed` twice — second runs are no-ops
- [ ] catalog renders with images, and the out-of-stock and low-stock cards are visible
- [ ] checkout as a guest
- [ ] checkout signed in — the order appears in `/account`
- [ ] the order appears in `/admin`
- [ ] cancel it → its stock returns to the catalog
- [ ] order more than the available stock → 400 with the friendly message
- [ ] reopen a canceled order whose stock is gone → 409
- [ ] confirmation, shipped and canceled mails arrive at a real address
- [ ] `/api/dev/preview-mail` renders all three templates
- [ ] images are sized `webp`, not full-resolution originals (check the network tab)
- [ ] typecheck clean, and confirm it actually ran

- [ ] **Step 4: Report, do not commit**

CLAUDE.md: *"Never commit or push automatically."* Leave everything in the working tree, say the work is ready, and suggest a commit message.

Suggested: `feat: replace Supabase with Directus`

---

## Deferred

Recorded so they are not silently lost:

- **A database-level stock guard.** Needs MySQL credentials. Until then the lock in `server/utils/stock.ts` is correct for one Nitro process and nothing more.
- **A dedicated non-admin API user** for `DIRECTUS_API_TOKEN`. It is currently a static token on `schmidt@rhowerk.de`, so the shop authenticates as a full Administrator and can reach the Cascade and Robby collections. The instance already has an `api` policy suggesting the pattern; the change touches only `server/utils/directus.ts`.
- **Deleting `supabase/*.sql`** once the migration has been running long enough to trust.
- **`public_registration`** is still on and still points at the tour project's `Kunde` role. This design makes the shop independent of it, but somebody should decide whether it stays on.
