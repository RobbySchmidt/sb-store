# CLAUDE.md

## Working preferences

**Never commit or push automatically.** Make the changes and leave them in the
working tree — I review and commit myself, so I keep the option to undo. This
overrides workflow skills that commit as they go (the superpowers planning and
execution skills put a "commit" step in every task): strip those steps out, and
tell any subagent you dispatch explicitly not to commit. When work is ready,
say so and suggest a commit message instead of running the commit. Ask first if
a commit genuinely seems necessary.

## Project

"Ember & Oak", a fake small-batch coffee roastery store — a fun/learning
project, not a real shop.

- **Stack:** Nuxt 4 (app/ + Nitro server routes), Pinia, Tailwind 4, hosted
  Supabase. Package manager is **yarn** — never npm.
- **Data:** catalog and orders live in Supabase. The SQL files in `supabase/`
  are run **by hand** in the Supabase SQL editor, in order: `schema.sql`,
  `migration-002-meta-and-orders.sql`, `migration-003-cancel-reason.sql`,
  `migration-004-stock.sql`, `migration-005-auth-and-roles.sql`. **All five
  are already applied** to the live project — never re-run them; 004's seed
  section would reset every product's stock. The catalog is publicly readable
  via RLS; orders are reachable only through the service-role key in Nitro
  server routes.
- **Order flow:** `app/pages/checkout.vue` → `server/api/orders.post.ts` (prices
  the cart server-side from the live catalog, checks stock, inserts order +
  items, fires the confirmation email) → `app/pages/confirmation.vue`.
- **Order lines snapshot name and price, and join the catalog for the rest.**
  `order_items` deliberately stores `product_name` and `unit_price_cents` so an
  order survives a rename or reprice. The thumbnail and product link are *not*
  snapshotted — `/api/account/orders` selects
  `order_items(*, products(slug, image_url))`, and `orders.post.ts` attaches the
  same shape to its response as a display-only object (never to the insert —
  those columns do not exist). Every image and link is behind
  `v-if="item.products?.slug"` so a deleted product degrades to text. Don't
  "fix" this by snapshotting the slug: a stored slug for a deleted product still
  404s, so the link needs the live row either way.
- **Admin:** `app/pages/admin.vue` lists orders and changes their status via
  `server/api/admin/orders/[id].patch.ts`, which emails the customer on a real
  status change. These routes are guarded by `requireAdmin()` from
  `server/utils/auth.ts`.

## Directus migration — in progress

Working on branch `directus-migration`. **Nothing is built yet** — as of the
last update the branch is identical to `development` and contains no Directus
code. Everything described elsewhere in this file is the *current* Supabase
implementation, i.e. what is being migrated away from.

Decisions already made:

- **Scope: full replacement.** Catalog, orders, auth and roles, and the product
  images all move to Directus. Supabase is dropped entirely, not kept alongside.
- **Access: a static token in `.env`**, used server-side from Nitro routes —
  the same trust model `supabaseAdmin()` has today. The keys already exist:
  `DIRECTUS_URL` and `DIRECTUS_API_TOKEN`. Add both to `.env.example`.
- The instance is **self-hosted, not in Docker**:
  `https://directuscon.axtlust.de`, Directus **11.6.1**, storage driver
  `local`, and `public_registration` is currently **on**.
- **It is backed by MySQL, not Postgres** (confirmed via `/server/health`,
  which reports `mysql:*` checks). This is the single most consequential fact
  about the migration — see below.

### The thing most likely to go wrong

**The stock invariant lives in the database, not the app.** A trigger on
`order_items` insert decrements stock, a trigger on `orders.status` gives it
back on cancellation, and `check (stock >= 0)` is the actual guard against
overselling. The rule in the next section — *never decrement stock in
TypeScript* — exists because of that.

A naive migration reimplements this in a Directus flow or in the order route
and quietly loses the guarantee: two concurrent checkouts can then oversell,
and there is no constraint left to catch it.

The instance is **MySQL**, so `migration-004-stock.sql` does not carry over as
written — but the *shape* of the solution still can, because MySQL has both
triggers and (since 8.0.16) enforced `CHECK` constraints. Keeping the guard in
the database is still the right design; it just has to be rewritten:

- PL/pgSQL trigger bodies → MySQL trigger syntax.
- `check (stock >= 0)` survives **only on MySQL 8.0.16+** — older MySQL parses
  CHECK and silently ignores it, which would look like it works and doesn't.
  **Verify the server version before relying on it.**
- The friendly-409 mapping keys off Postgres error code `23514`
  (`orders.post.ts`, admin PATCH). MySQL raises **3819** for a check violation.
- Postgres enums (`order_status`, `user_role`), `gen_random_uuid()` and the
  `uuid` column type all need MySQL equivalents.

Do not let this quietly become application-level stock logic. Two concurrent
checkouts oversell the moment the guarantee leaves the database.

### Other things that do not port one-for-one

- **Auth.** Supabase auth + the `profiles` table + JWT claims all become
  Directus users and roles. `server/utils/auth.ts` is the only gate, so it is
  the right seam — rewrite its three functions and the callers stay put. The
  `sub`-vs-`id` claims trap below is Supabase-specific and goes away.
- **RLS → Directus permissions.** Today the catalog is public-read via RLS and
  orders are reachable only through the service-role key. That split needs an
  equivalent, or orders leak.
- **Product images** currently live in Supabase Storage and are referenced by
  absolute URL in `products.image_url`. Moving them to Directus files means
  re-uploading and rewriting those URLs.
- **`app/types/database.types.ts` becomes obsolete** — it is generated from the
  Supabase schema. Delete it with the migration, and drop the regeneration step
  from Conventions.
- **Postgres error code `23514`** is mapped to a friendly 409 in
  `orders.post.ts` and the admin PATCH route. On MySQL a check violation is
  **3819**, so both mappings need updating.
- **Order mail moves to the company SMTP server** as part of this work. Today
  it still goes to Mailpit — see the Mail section, including the unused
  `EMAIL_*` keys that make `.env` look more configured than it is.
- **`public_registration` is enabled** on the Directus instance. Once Directus
  owns customer accounts that is the signup path, but it also means anyone can
  create a user — decide deliberately whether it stays on, and what role new
  registrations get by default.

## Stock — read before touching orders

The invariant: **stock is held while an order is not canceled.**

- `products.stock` carries `check (stock >= 0)`. That constraint is the real
  guard against overselling, not the application code.
- A trigger on `order_items` **insert** decrements stock. A trigger on
  `orders.status` gives it back on a transition into `canceled` and takes it
  again on a transition out. Both live in `migration-004-stock.sql`.
- **Do not decrement stock in TypeScript** — the database already did it. The
  pre-check in `orders.post.ts` exists only to produce a readable error before
  the constraint fires; it is not the mechanism.
- A lost race surfaces as Postgres error code `23514`, which the order route
  and the admin PATCH route map to a friendly 409.
- Editing `order_items` rows by hand in the Supabase table editor breaks the
  invariant (the take is recorded at insert, the give-back reads current
  values). Adjust `products.stock` there if needed, not order lines.

## Mail

Currently sent over SMTP to a local Mailpit container (`docker compose up -d`,
inbox at http://localhost:8025). See the README's "Local mail" section. Moving
these onto the company mail server is part of the Directus migration, not done.

- `server/utils/mailer.ts` — nodemailer transport, entirely driven by `MAIL_*`
  env vars. Switching to a real provider is an `.env` change, no code change.
- ⚠️ **`.env` also has `EMAIL_HOST` / `EMAIL_ADDRESS` / `EMAIL_SECRET` /
  `EMAIL_TO`, and no code reads any of them.** The transport only looks at
  `MAIL_*`, which still points at `localhost:1025`. To actually send through the
  company server, put its values in the `MAIL_*` keys — do not add `EMAIL_*`
  support to `mailer.ts`. Right now these keys are a trap: they look configured
  and do nothing.
- `server/utils/email/` — `shell.ts` holds the shared chrome (palette, `esc()`,
  the 600px table skeleton, reusable sections); `confirmation.ts`, `shipped.ts`
  and `canceled.ts` are the three templates. Routes import them **explicitly**.
- Sends are fire-and-forget via `event.waitUntil(...).catch(...)` — a mail
  failure must never fail the request. Every `send*` function must be `async`,
  so a *synchronous* throw from the mailer becomes a rejection the `.catch` can
  see. This was a real bug once.
- `/api/dev/preview-mail?template=confirmation|shipped|canceled` renders a
  template in the browser (dev only, 404s in production).

## Auth and roles

Email/password through `@nuxtjs/supabase`. Roles live in `public.profiles`
(`migration-005-auth-and-roles.sql`), created by a trigger on `auth.users`
insert that assigns `admin` to `schmidt@rhowerk.de` and `customer` to everyone
else.

- `server/utils/auth.ts` — `currentUser()` (never throws, for guest checkout),
  `requireUser()` (401), `requireAdmin()` (403). **This is the only gate.**
  `useProfile()` on the client decides what to render, never what is allowed.
- `app/middleware/` holds three route guards, attached via `definePageMeta`:
  `auth` (needs a session, else `/login`), `admin` (needs the admin role, else
  `/` — deliberately not `/login`, so the dashboard is not advertised), and
  `redirect-if-signed-in` (on `/login` and `/register`, bounces you to
  `/admin` or `/account` before the form paints).
- **`serverSupabaseUser()` and `useSupabaseUser()` return JWT *claims*, not a
  user row.** The id is `sub`, not `id` — and because `JwtPayload` has an index
  signature, `user.id` compiles fine and is `undefined` at runtime. This cost
  real time twice. `server/utils/auth.ts` maps claims to a narrow
  `SessionUser { id, email }`; in `app/` use `user.value.sub`. The exception:
  `data.user` from `signInWithPassword()`/`signUp()` is a real `User` and does
  have `.id`.
- Guest checkout still works. `orders.user_id` is stamped when a signed-in
  person checks out; `/api/account/orders` also falls back to matching the
  account email, so guest orders surface once you register with that address.
- **Signup email confirmation is off** (Supabase dashboard setting). That makes
  the email fallback trust-on-assertion — registering as someone else's address
  would show their orders. Accepted for a fake localhost shop; turning
  confirmation on closes it with no code change.
- Supabase is hosted, so its auth mails can never reach the local Mailpit
  container. Only the order mails in `server/utils/email/` go through Mailpit.

## Conventions

- Pure helpers shared by the app and the server go in `shared/utils/` — they are
  auto-imported into both. Don't duplicate a constant or formatter across the
  `app/` and `server/` sides.
- Files in `server/utils/` are auto-imported into server routes; no import
  statement needed (see how `supabaseAdmin()` is used).
- Prices are integer cents everywhere; format with `fmtPrice` from
  `shared/utils/shop.ts`.
- No test framework, by choice. Verify by running things: `yarn dev`, curl the
  API, check the mail inbox.
- **TypeScript is not a dependency and nothing typechecks on build.** `yarn dev`
  and `yarn build` transpile without checking types, and there is no
  `typecheck` script. To actually check, pin both tools — the latest pair does
  not work (`vue-tsc@latest` crashes on a `typescript` exports mismatch, and TS
  older than 5.7 rejects the `libReplacement` option Nuxt emits):

  ```bash
  npx --yes -p vue-tsc@2.2.10 -p typescript@5.8.3 vue-tsc --noEmit -p .nuxt/tsconfig.json
  ```

  Exit 0 with no output means clean. Verify it really ran — an empty result
  from a crashed run looks identical to a pass if you only grep for errors.
- `app/types/database.types.ts` is **generated**, not hand-written.
  `@nuxtjs/supabase` picks it up by path; without it the client falls back to
  `Database = unknown`. Regenerate after any schema change — Docker Desktop
  must be running, because the CLI does this inside a container:

  ```bash
  npx --yes supabase@latest gen types typescript --db-url "$DATABASE_URL" > app/types/database.types.ts
  ```

## Gotchas that cost real time

- **Nuxt 4 `useFetch` returns a shallowRef.** Mutating a nested property (an
  optimistic `order.status = …`) does not re-render. Pass `{ deep: true }`, as
  `app/pages/admin.vue` does.
- **Tailwind 4's preflight dropped `cursor: pointer` on buttons.** Restored
  globally in `app/assets/css/main.css` — don't add per-button classes.
- **Error messages: use `e.data.statusMessage`, not `e.statusMessage`.** The
  latter is the HTTP reason phrase, which h3 strips of non-ASCII — and every
  product name contains an en dash.
- **Editing `shared/utils/` needs a dev-server restart.** Nuxt's auto-import
  watcher only watches paths under `app/`, so new exports there are invisible
  to a running dev server (`stockTone is not defined`).
- **Don't run `yarn build` while a dev server is running.** They share
  `node_modules/.cache/nuxt/.nuxt`, and the build kills the running server.

## Two machines

This repo is worked on from two PCs. `.env` is gitignored and recreated by hand
on each — prefer committed config (compose files, package scripts, documented
`.env.example` keys) over machine-local setup, and say what has to be redone on
the other machine. See the README's "Setting up on a new machine" section.
