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
- **Data:** catalog and orders live in Supabase. `supabase/schema.sql` and
  `supabase/migration-002-meta-and-orders.sql` are run by hand in the Supabase
  SQL editor. The catalog is publicly readable via RLS; orders are reachable
  only through the service-role key in Nitro server routes.
- **Order flow:** `app/pages/checkout.vue` → `server/api/orders.post.ts` (prices
  the cart server-side from the live catalog, inserts order + items, fires the
  confirmation email) → `app/pages/confirmation.vue`.
- **Mail:** sent over SMTP to a local Mailpit container (`docker compose up -d`,
  inbox at http://localhost:8025). See the README's "Local mail" section.

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

## Two machines

This repo is worked on from two PCs. `.env` is gitignored and recreated by hand
on each — prefer committed config (compose files, package scripts, documented
`.env.example` keys) over machine-local setup, and say what has to be redone on
the other machine. See the README's "Setting up on a new machine" section.
