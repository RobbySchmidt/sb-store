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
  `migration-004-stock.sql`. **All four are already applied** to the live
  project — never re-run them; 004's seed section would reset every product's
  stock. The catalog is publicly readable via RLS; orders are reachable only
  through the service-role key in Nitro server routes.
- **Order flow:** `app/pages/checkout.vue` → `server/api/orders.post.ts` (prices
  the cart server-side from the live catalog, checks stock, inserts order +
  items, fires the confirmation email) → `app/pages/confirmation.vue`.
- **Admin:** `app/pages/admin.vue` lists orders and changes their status via
  `server/api/admin/orders/[id].patch.ts`, which emails the customer on a real
  status change. These routes have **no authentication** — a known, accepted
  gap for a localhost project.

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

Sent over SMTP to a local Mailpit container (`docker compose up -d`, inbox at
http://localhost:8025). See the README's "Local mail" section.

- `server/utils/mailer.ts` — nodemailer transport, entirely driven by `MAIL_*`
  env vars. Switching to a real provider is an `.env` change, no code change.
- `server/utils/email/` — `shell.ts` holds the shared chrome (palette, `esc()`,
  the 600px table skeleton, reusable sections); `confirmation.ts`, `shipped.ts`
  and `canceled.ts` are the three templates. Routes import them **explicitly**.
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
- Files in `server/utils/` are auto-imported into server routes; no import
  statement needed (see how `supabaseAdmin()` is used).
- Prices are integer cents everywhere; format with `fmtPrice` from
  `shared/utils/shop.ts`.
- No test framework, by choice. Verify by running things: `yarn dev`, curl the
  API, check Mailpit.

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
