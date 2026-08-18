# Auth, roles and customer accounts — design

Date: 2026-08-18
Status: approved, not yet implemented

## Problem

Ember & Oak has no authentication of any kind.

- `app/pages/admin.vue` is a public page; anyone with the URL sees every order.
- `server/api/admin/orders.get.ts` and `server/api/admin/orders/[id].patch.ts`
  reach straight for `supabaseAdmin()` (service role, bypasses RLS) with no
  session check.
- `@nuxtjs/supabase` is installed and configured with `redirect: false`, but the
  only consumer is `app/composables/useShop.ts` reading the public catalog.
- `orders` has no `user_id`. An order is identified only by the email typed into
  checkout, so there is nothing to build an order history on.

We want three things: a login entry point in the navigation, role-based routing
(admin to the dashboard, customer to their own order history), and user
registration.

## Decisions

| Question | Decision |
|---|---|
| Where the role lives | `public.profiles` table with a `role` column |
| Order to account link | nullable `orders.user_id`, plus a fallback match on email |
| Guest checkout | stays — login is never required to buy |
| Signup email confirmation | off |
| Admin bootstrap | admin email hardcoded in the signup trigger |
| Nav treatment | user icon opening a dropdown, beside the Cart pill |

### Why email confirmation is off, and what it costs

The Supabase project is hosted, so its confirmation mail cannot reach the local
Mailpit container on `localhost:1025`. It would have to go through Supabase's
built-in sender (rate-limited to a handful per hour on the free tier) or a real
external SMTP provider. Neither uses the Ember & Oak templates in
`server/utils/email/`.

Confirmation is therefore disabled, which makes the email fallback below
trust-on-assertion: registering as `felix.m@mail.de` would surface the seeded
orders for that address. This is an **accepted gap**, in the same spirit as the
currently-unauthenticated admin routes — a fake shop with fake data on
localhost. It is recorded here and in CLAUDE.md so it is a choice, not an
oversight. Turning confirmation on in the Supabase dashboard closes it with no
code change.

## Part 1 — Data layer

One new hand-run migration: `supabase/migration-005-auth-and-roles.sql`.

It is **purely additive**. It does not touch `products`, `order_items`, or any
seed block, so the stock invariant and every existing row are untouched. It must
be run once in the Supabase SQL editor, after `migration-004-stock.sql`.

### profiles

```sql
create type public.user_role as enum ('customer', 'admin');

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       public.user_role not null default 'customer',
  created_at timestamptz not null default now()
);
```

### Signup trigger

An `after insert on auth.users` trigger writes the profile row and assigns the
role by email:

```sql
case when lower(new.email) = 'schmidt@rhowerk.de'
     then 'admin'::public.user_role
     else 'customer'::public.user_role end
```

The backing function is `security definer` with `set search_path = ''`
(Supabase's recommended hardening), so every identifier inside it is fully
qualified.

Because the trigger only fires on insert, the migration follows it with an
idempotent backfill over any pre-existing `auth.users`, using
`on conflict (id) do nothing`. The file is therefore safe to run once regardless
of what already exists in the dashboard.

### RLS on profiles

Select only, `id = (select auth.uid())`. You can read your own row; no client can
write a role. Role changes happen in the Supabase table editor or through the
service role.

### orders gets the link

```sql
alter table public.orders
  add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists orders_user_id_idx on public.orders (user_id);
```

`on delete set null`, not `cascade` — deleting an account must not erase order
history, only orphan it.

No RLS policy is added to `orders`. They remain reachable only through the
service role in Nitro routes, exactly as today.

### Dashboard step (not SQL)

Authentication → Providers → Email → **Confirm email: off**.

This is project-level config on the hosted instance, so it applies to both PCs.
Nothing to redo on the second machine.

## Part 2 — Server enforcement

### New `server/utils/auth.ts`

Auto-imported into server routes, like `supabaseAdmin()`.

```ts
import { serverSupabaseUser } from '#supabase/server'

currentUser(event)   // User | null — never throws; for optional-session cases
requireUser(event)   // User        — throws 401 'Not signed in'
requireAdmin(event)  // User        — requireUser, then profiles.role must be
                     //               'admin', else throws 403 'Admins only'
```

`serverSupabaseUser` validates the JWT against Supabase rather than trusting a
cookie, so this is real verification. `requireAdmin` adds one `supabaseAdmin()`
read of `profiles.role`.

### Route changes

| Route | Change |
|---|---|
| `server/api/admin/orders.get.ts` | take `event`, `await requireAdmin(event)` as the first statement |
| `server/api/admin/orders/[id].patch.ts` | `await requireAdmin(event)` before any body validation |
| `server/api/orders.post.ts` | `const user = await currentUser(event)`, then stamp `user_id: user?.id ?? null` onto the order insert |
| `server/api/account/orders.get.ts` (new) | `requireUser(event)`, return that person's orders |

`orders.post.ts` keeps working for guests. Nothing else in it changes — in
particular the stock pre-check and the fire-and-forget confirmation mail are
untouched, and stock is still decremented by the database trigger.

### The account-orders query

Two queries, merged on `id` via a `Map`:

1. `.eq('user_id', user.id)`
2. `.eq('email', user.email)`

Not a single PostgREST `.or()`. That filter is built by string concatenation, so
an email containing a comma or parenthesis would silently corrupt it. Two
queries and a merge is about six lines and is obviously correct.

Results are sorted by `created_at` descending after merging.

### Client-side role

`app/composables/useProfile.ts` reads your own `profiles` row through
`useSupabaseClient()`, the same way `app/composables/useShop.ts` reads the
catalog. This is what the RLS select policy exists for. It exposes `role` and
`isAdmin`, holds them in `useState` so the value is shared and survives SSR, and
re-fetches when `useSupabaseUser()` changes.

**This client role is for UI only** — which dropdown items to show, where to
redirect after login. It is never the gate. Anyone can curl `/api/admin/orders`,
so `requireAdmin` on the server is the actual protection.

### Types

In `app/types/shop.ts`:

- `user_id: string | null` added to `Order`
- new `UserRole = 'customer' | 'admin'`
- new `Profile { id, email, role, created_at }`

## Part 3 — Pages and UI

### New pages

All three use the default layout, so they get the header, footer and cart drawer.

**`app/pages/login.vue`** — email and password, `supabase.auth.signInWithPassword`.
On success, read the role and `navigateTo('/admin')` for admins,
`navigateTo('/account')` for everyone else. Redirects away if already signed in.
Links to register.

**`app/pages/register.vue`** — email and password, Supabase's six-character
minimum. `supabase.auth.signUp` returns a session immediately with confirmation
off, so it lands on the same role-based redirect. Links to login.

No name field. Checkout already collects `customer_name`; duplicating it here
would create two sources of truth for no current benefit.

**`app/pages/account.vue`** — your email, a sign-out button, and your orders from
`/api/account/orders`. Each order shows its number, date, status, items and
total. Empty state links to `/shop`.

### New component

**`app/components/AccountMenu.vue`** — the dropdown. Signed out: "Log in",
"Create account". Signed in: your email, "My orders", "Admin dashboard" (admins
only), "Sign out". Closes on outside click, on Escape, and on route change,
mirroring how `menuOpen` already resets in `StoreHeader.vue`.

`StoreHeader.vue` mounts it as a user icon beside the Cart pill on desktop, and
renders the same items as a section in the mobile full-screen menu, below THE
SHELVES.

### Middleware

The `app/middleware/` directory is created by this work.

- `app/middleware/auth.ts` — `/account` requires a session, else `/login`.
- `app/middleware/admin.ts` — `/admin` requires `role === 'admin'`, else `/`.

### admin.vue

`middleware: 'admin'` joins its existing `definePageMeta({ layout: false })`, and
a sign-out control is added to its own header bar, since it has no store chrome.

### Customer-facing status wording

Admin vocabulary is not customer vocabulary — `marked` means nothing to a buyer.
The mapping reuses the wording the customer has already been sent by mail:

| status | admin label | customer label | source of the wording |
|---|---|---|---|
| `open` | Open | Confirmed | `confirmation.ts` — "Order … confirmed" |
| `marked` | Marked | On its way | `shipped.ts` — "is on its way" |
| `canceled` | Canceled | Canceled | `canceled.ts` |

A `customerOrderStatus()` formatter goes in `shared/utils/shop.ts`, beside
`fmtPrice`. The `STATUS` map in `admin.vue` is unchanged; admin vocabulary stays
admin vocabulary.

## Error handling

- API errors surfaced in pages read `e.data.statusMessage`, never
  `e.statusMessage` — h3 strips non-ASCII from the reason phrase and product
  names contain en dashes.
- Supabase SDK auth errors are a different shape: an `error` object returned from
  the call, read via `error.message`. Login and register handle those separately
  from h3 errors.
- A 401 or 403 from an admin route is a bug in the middleware, not an expected
  state, but the pages still render the message rather than a blank screen.
- Mail behaviour is unchanged. Sends stay fire-and-forget through
  `event.waitUntil(...).catch(...)`.

## Verification

No test framework, by choice. Verify by running things.

1. `yarn dev`, restart after `shared/utils/shop.ts` changes.
2. Register a new address → lands on `/account`, `profiles` row has role
   `customer`.
3. Register `schmidt@rhowerk.de` → lands on `/admin`, role `admin`.
4. Signed out, visit `/admin` → redirected to `/`.
5. Signed out, `curl` `/api/admin/orders` → 401, not order JSON.
6. Signed in as a customer, `curl` `/api/admin/orders` with that session cookie
   → 403.
7. Check out while signed in → new order row carries `user_id`, order appears
   on `/account`, confirmation mail still arrives in Mailpit at
   http://localhost:8025.
8. Check out as a guest with an address that has an account → order still
   placed, and it appears on that account via the email fallback.
9. Admin marks an order shipped → `/account` shows "On its way", customer gets
   the shipped mail.
10. Product stock still moves only via the database triggers; cancelling and
    reopening an order behaves exactly as before.

## Out of scope

Password reset, email change, editing profile details, magic links, OAuth
providers, and an admin UI for changing other users' roles.

## Second machine

Nothing machine-local is introduced. The migration and the "Confirm email: off"
setting both live on the shared hosted Supabase project, so they are done once,
not once per PC. No new `.env` keys — `SUPABASE_URL` and `SUPABASE_KEY` are
already required by `@nuxtjs/supabase`.
