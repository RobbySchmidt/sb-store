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

- **Stack:** Nuxt 4 (app/ + Nitro server routes), Pinia, Tailwind 4, and a
  self-hosted **Directus 11.6.1** instance at `https://directuscon.axtlust.de`.
  Package manager is **yarn** — never npm.
- **The Directus instance is shared with other projects.** `Cascade_Academy`
  and its six `cascade_*` collections, the `Robby` group (`project_style`,
  `accent_colors`, `primary_colors`, `secondary_colors`, `border_radius`) and
  `shader_presets` belong to other work. **Never write to them.** Everything of
  ours lives in the `Ember_Oak_Shop` collection group and is prefixed `eo_`.
- **Data:** four collections — `eo_categories`, `eo_products`, `eo_orders`,
  `eo_order_items`. The schema is created by a checked-in script, not by hand:

  ```bash
  yarn directus:setup   # role, policy, file folder, collections, fields, relations
  yarn directus:seed    # categories, products, images, the 8 demo orders
  ```

  Both are **idempotent** — a second run reports only "exists"/"skip". They
  replace the old hand-run `supabase/*.sql` files and are how a second machine
  gets a matching instance.
- **Access is server-side only.** `server/utils/directus.ts` exposes
  `directus()`, an `@directus/sdk` client on the static `DIRECTUS_API_TOKEN`.
  That token belongs to a full Administrator, so it bypasses permissions the
  way the Supabase service-role key used to — it must never reach the client.
  The browser talks only to our own Nitro routes.
- **Order flow:** `app/pages/checkout.vue` → `server/api/orders.post.ts` (prices
  the cart server-side from the live catalog, checks availability, inserts order
  + lines, fires the confirmation email) → `app/pages/confirmation.vue`.
- **Order lines snapshot name and price, and expand the catalog for the rest.**
  `eo_order_items` deliberately stores `product_name` and `unit_price_cents` so
  an order survives a rename or reprice. The thumbnail and product link are
  *not* snapshotted — the routes expand `product` to `id, slug, image`, and
  every image and link sits behind `v-if="item.product?.slug"` so a deleted
  product degrades to text. Don't "fix" this by snapshotting the slug: a stored
  slug for a deleted product still 404s, so the link needs the live row anyway.
- **Admin:** `app/pages/admin.vue` lists orders and changes their status via
  `server/api/admin/orders/[id].patch.ts`, which emails the customer on a real
  status change. Guarded by `requireAdmin()` from `server/utils/auth.ts`.

The migration off Supabase was completed on 2026-08-18. The design and the
reasoning behind it are in `docs/superpowers/specs/2026-08-18-directus-migration-design.md`;
the executed plan, including three bugs found during it, is in
`docs/superpowers/plans/2026-08-18-directus-migration.md`. `supabase/*.sql` is
kept only as the record of the old system — nothing reads it.

## Stock — read before touching orders

The invariant is unchanged: **stock is held while an order is not canceled.**
The mechanism is completely different from the Supabase version.

**Stock is derived, never stored as a counter.**

```
available(p) = stock_initial(p) − Σ quantity over eo_order_items
               whose order.status ≠ 'canceled'
```

- `eo_products.stock_initial` is the **only** stock value in the database.
  `stock_available` is computed by `/api/catalog` and never written back.
  **Never write an availability number to the database.**
- Checkout is **insert-only**. Nothing is decremented, so there is no lost
  update to lose.
- Cancelling needs **no give-back** and un-cancelling **no re-take** — the
  filter does both. There are no triggers.
- **Hand-editing an order line is now safe.** Under the old trigger design it
  silently corrupted the invariant; under the derived model it is just correct.

**Why it is not a database guarantee any more.** Directus offers no API for
`CREATE TRIGGER` and its field API cannot create `CHECK` constraints, so
`check (stock >= 0)` has no equivalent. Directus `PATCH` also writes absolute
values only, so a decrement from Nitro would be a read-modify-write; filtered
updates do not rescue it, because Directus resolves a filter to primary keys in
one query and updates by key in a second.

What closes the remaining check-then-insert window is `withStockLock()` in
`server/utils/stock.ts`, an in-process async lock held across
read-availability → verify → insert. **It is correct for a single Nitro process
and nothing more.** Do not describe it as a database guarantee. If this ever
runs on more than one instance, get MySQL credentials and add a trigger.

Two places take the lock: checkout, and the admin PATCH when a status leaves
`canceled` — that transition re-takes stock, so it checks availability first
and returns 409. Under Supabase a constraint caught that; now only this check
does. The old Postgres `23514` mapping is gone entirely.

`meta.validation` (`price_cents >= 0`, `quantity >= 1`) is enforced by the
Directus **API layer**, not the database. It holds because every write goes
through Directus, but it is not a constraint.

## Auth and roles

Directus users and roles, with sessions managed by our own Nitro routes.

- `server/utils/auth.ts` — `currentUser()` (never throws, for guest checkout),
  `requireUser()` (401), `requireAdmin()` (403). **This is the only gate.**
  `useProfile()` on the client decides what to render, never what is allowed.
- `requireAdmin()` reads `admin_access` from **`GET /policies/me/globals`**,
  which resolves every policy on the user *and* their role in one call. Any
  Directus Administrator counts — which on this shared instance means all of
  Robby's colleagues too. Narrowing that means editing `requireAdmin()` only.
- **Sessions are Nitro-managed httpOnly cookies** (`eo_at`, `eo_rt`) holding
  Directus's access and refresh tokens. Not Directus's own session-cookie mode,
  which would need cross-origin `SameSite=None` on a domain we don't control.
  Directus rotates refresh tokens on use, so `currentUser()` only refreshes
  when the access token is gone, and treats a failed refresh as "signed out".
- **Customers get their own `Ember & Oak Customer` role**, created by
  `directus:setup`, and register through `/api/auth/register` using the admin
  token. Deliberately *not* Directus's built-in `/users/register`:
  `public_registration_role` is a single global setting the tour-booking
  project on this instance depends on.
- **The customer policy grants exactly one thing: read own `id` and `email` on
  `directus_users`.** Nothing else — a customer token gets 403 on every `eo_*`
  collection, because all shop data is read server-side. That one permission is
  load-bearing: without it `/users/me` returns an id and no email, and the
  email fallback below silently stops finding anything.
- `app/middleware/` holds three route guards, attached via `definePageMeta`:
  `auth` (needs a session, else `/login`), `admin` (needs the admin role, else
  `/` — deliberately not `/login`, so the dashboard is not advertised), and
  `redirect-if-signed-in` (on `/login` and `/register`, bounces you to
  `/admin` or `/account` before the form paints).
- Guest checkout still works. `eo_orders.user` is stamped when a signed-in
  person checks out; `/api/account/orders` also falls back to matching the
  account email, so guest orders surface once you register with that address.
- **That email fallback is trust-on-assertion.** Nothing verifies the address —
  registering as someone else's email would show their orders. Accepted for a
  fake shop. Directus's `public_registration_verify_email` is off, and our own
  register route does not verify either.
- `public_registration` is still **on** at the instance level and still points
  at the *other* project's `Kunde` role. We are independent of it either way,
  but somebody should decide whether it stays on.

## Mail

Order mail goes to the **company SMTP server** (`mail.agenturserver.de`) and
reaches real inboxes. Mailpit is no longer wired up — the compose file is still
there for offline work, but you have to point `MAIL_*` back at `localhost:1025`
yourself.

- `server/utils/mailer.ts` — nodemailer transport, entirely driven by `MAIL_*`
  env vars. Switching providers is an `.env` change, no code change.
- **Port 465 with implicit TLS, not 587.** `mailer.ts` does not set
  `requireTLS`, so on 587 the connection would only *opportunistically* upgrade
  via STARTTLS. All three of 25/587/465 authenticate on that server; 465 is the
  one that is encrypted from the first byte with no code change.
- The old `EMAIL_HOST` / `EMAIL_ADDRESS` / `EMAIL_SECRET` / `EMAIL_TO` keys are
  **gone**. Nothing ever read them; they made `.env` look configured when it
  wasn't. **Do not add `EMAIL_*` support to `mailer.ts`** — put values in
  `MAIL_*`.
- `server/utils/email/` — `shell.ts` holds the shared chrome (palette, `esc()`,
  the 600px table skeleton, reusable sections) **and every order field access**;
  `confirmation.ts`, `shipped.ts` and `canceled.ts` are thin templates that
  reference no order fields at all. If a field rename breaks the mails, the fix
  is almost certainly in `shell.ts`.
- Sends are fire-and-forget via `event.waitUntil(...).catch(...)` — a mail
  failure must never fail the request. Every `send*` function must be `async`,
  so a *synchronous* throw from the mailer becomes a rejection the `.catch` can
  see. This was a real bug once.
- `/api/dev/preview-mail?template=confirmation|shipped|canceled` renders a
  template in the browser (dev only, 404s in production).

## Conventions

- Pure helpers shared by the app and the server go in `shared/utils/` — they are
  auto-imported into both. Don't duplicate a constant or formatter across the
  `app/` and `server/` sides.
- Collection types live in `shared/types/directus.ts`, hand-written, including
  the `Schema` that parameterises the SDK client. `app/types/shop.ts` holds only
  genuinely client-side view models (`CartItem`). There is no generated types
  step any more.
- **The app speaks Directus's field names**, deliberately — `date_created`,
  `date_updated`, `image`, `category`, `product`, `user`, `order.items[]`. There
  is no translation layer back to the old PostgREST names, and adding one would
  be a step backwards.
- Product images are Directus file ids, turned into URLs by `assetUrl()` /
  `useAssetUrl()`, which request a sized `webp` rather than the original.
- Files in `server/utils/` are auto-imported into server routes; no import
  statement needed (see how `directus()` is used).
- Prices are integer cents everywhere; format with `fmtPrice` from
  `shared/utils/shop.ts`.
- No test framework, by choice. Verify by running things: `yarn dev`, curl the
  API, check the inbox.
- **TypeScript is not a dependency and nothing typechecks on build.** `yarn dev`
  and `yarn build` transpile without checking types, and there is no
  `typecheck` script. This matters more now than it used to — it is the only
  mechanical check that a field rename was missed. Pin both tools; the latest
  pair does not work (`vue-tsc@latest` crashes on a `typescript` exports
  mismatch, and TS older than 5.7 rejects the `libReplacement` option Nuxt
  emits):

  ```bash
  npx --yes -p vue-tsc@2.2.10 -p typescript@5.8.3 vue-tsc --noEmit -p .nuxt/tsconfig.json
  ```

  Exit 0 with no output means clean. Verify it really ran — an empty result
  from a crashed run looks identical to a pass if you only grep for errors.

## Gotchas that cost real time

- **Nuxt 4 `useFetch` returns a shallowRef.** Mutating a nested property (an
  optimistic `order.status = …`) does not re-render. Pass `{ deep: true }`, as
  `app/pages/admin.vue` does.
- **Tailwind 4's preflight dropped `cursor: pointer` on buttons.** Restored
  globally in `app/assets/css/main.css` — don't add per-button classes.
- **Error messages: use `e.data.statusMessage`, not `e.statusMessage`.** The
  latter is the HTTP reason phrase, which h3 strips of non-ASCII — and every
  product name contains an en dash.
- **Editing `shared/` needs a dev-server restart.** Nuxt's auto-import watcher
  only watches paths under `app/`, so new exports there are invisible to a
  running dev server (`stockTone is not defined`).
- **Don't run `yarn build` while a dev server is running.** They share
  `node_modules/.cache/nuxt/.nuxt`, and the build kills the running server.
- **`setCookie()` writes the *response*; `getCookie()` reads the *request*.**
  Setting a session cookie and then calling `currentUser(event)` in the same
  request returns null — the cookie isn't visible yet. `/api/auth/login` and
  `/register` use `userForToken(token)` with the token already in hand. This
  shipped as "login silently returns HTTP 204" once.
- **Plain `$fetch` sends no cookies during SSR.** `useProfile().refresh()` uses
  `useRequestFetch()` so the incoming httpOnly session cookie is forwarded;
  with `$fetch` every hard load looks signed-out to the middleware and a
  signed-in admin opening `/admin` gets bounced to `/`.
- **A route returning `null` serialises as HTTP 204 with an empty body**, not
  `null`. `/api/auth/me` does this when signed out. `ofetch` turns it into
  `null` client-side, but don't write anything that expects a literal body.
- **Directus roles, policies and folders have no unique constraint on `name`.**
  A "POST and catch the duplicate error" idempotency trick silently creates a
  second copy on every run. `directus/setup.ts` uses GET-then-POST for those.
- **Directus ignores a supplied `date_created` on insert** (it carries
  `special: ['date-created']`) and stamps its own. `directus/seed.ts` PATCHes
  the intended date immediately afterwards — the field is only guarded on
  create.
- **`.env` cannot be sourced with `. ./.env` in bash** — some values are
  unquoted and the shell tries to execute them. Use `node --env-file=.env`.

## Two machines

This repo is worked on from two PCs. `.env` is gitignored and recreated by hand
on each — prefer committed config (compose files, package scripts, documented
`.env.example` keys) over machine-local setup, and say what has to be redone on
the other machine.

The schema now lives on a shared hosted instance and `directus:setup` /
`directus:seed` are idempotent, so the second machine needs only `yarn install`
and a recreated `.env`. See the README's "Setting up on a new machine" section.
