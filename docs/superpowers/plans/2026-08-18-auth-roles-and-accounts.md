# Auth, Roles and Customer Accounts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This project never commits automatically.** CLAUDE.md is explicit: make the changes and leave them in the working tree. No task below contains a commit step, and none should be added. If you are a subagent working on this plan, do not run `git commit` or `git push`.
>
> **This project has no test framework, by choice.** Verification steps are real commands and browser checks, not automated tests. Do not add vitest/jest.

**Goal:** Give Ember & Oak email/password authentication with `admin` and `customer` roles, so the admin dashboard is actually protected, customers get an order-history page, and the header offers login/registration.

**Architecture:** Roles live in a `public.profiles` table written by a trigger on `auth.users` insert. Nitro server routes are the enforcement point via a new `server/utils/auth.ts`; the client-side role is UI-only. Orders gain a nullable `user_id`, with a fallback match on the account email so guest orders still surface.

**Tech Stack:** Nuxt 4, `@nuxtjs/supabase` 2.0.10 (already installed, `redirect: false`), hosted Supabase, Tailwind 4, yarn.

**Spec:** `docs/superpowers/specs/2026-08-18-auth-roles-and-accounts-design.md`

> ### ⚠️ Read this before writing any auth code
>
> In `@nuxtjs/supabase` 2.0.10, **both** `serverSupabaseUser(event)` and
> `useSupabaseUser()` return **JWT claims**, not a row from `auth.users`:
>
> - the user id is **`sub`**, never `id`
> - `claims.role` is the *Postgres* role (`authenticated`), never our app role
> - `JwtPayload` has a `[key: string]: any` index signature, so `user.id`
>   **compiles fine and is `undefined` at runtime** — the failure is silent
>
> So: `user.value.sub` in `app/`, and `server/utils/auth.ts` maps claims into a
> narrow `SessionUser { id, email }` so server routes can keep saying `user.id`.
>
> **The exception:** the object returned by `supabase.auth.signInWithPassword()`
> and `supabase.auth.signUp()` — i.e. `data.user` — is a genuine `User` from the
> auth SDK and **does** have `.id`. Do not "correct" those to `.sub`.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `supabase/migration-005-auth-and-roles.sql` | profiles table, role enum, signup trigger, `orders.user_id` |
| `server/utils/auth.ts` | `currentUser` / `requireUser` / `requireAdmin` — the only enforcement point |
| `server/api/account/orders.get.ts` | a signed-in person's own orders |
| `app/composables/useProfile.ts` | cached profile + `role` / `isAdmin` / `landingPath` for UI |
| `app/plugins/profile.client.ts` | keeps that cache in sync with the auth session |
| `app/middleware/auth.ts` | `/account` needs a session |
| `app/middleware/admin.ts` | `/admin` needs `role === 'admin'` |
| `app/pages/login.vue` | sign in, then route by role |
| `app/pages/register.vue` | sign up, then route by role |
| `app/pages/account.vue` | email, sign out, own order history |
| `app/components/AccountMenu.vue` | header dropdown, both breakpoints |

**Modified**

| Path | Change |
|---|---|
| `app/types/shop.ts` | `Order.user_id`, `UserRole`, `Profile` |
| `shared/utils/shop.ts` | `customerOrderStatus()` |
| `server/api/admin/orders.get.ts` | `requireAdmin` |
| `server/api/admin/orders/[id].patch.ts` | `requireAdmin` |
| `server/api/orders.post.ts` | stamp `user_id` |
| `app/components/StoreHeader.vue` | mount `AccountMenu` desktop + mobile |
| `app/pages/admin.vue` | `middleware: 'admin'` + sign-out control |
| `CLAUDE.md`, `README.md` | document auth, retire the "no authentication" gap |

No `.env.example` change: this work introduces no new environment keys.
`SUPABASE_URL` and `SUPABASE_KEY` are already required by `@nuxtjs/supabase`.

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migration-005-auth-and-roles.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migration-005-auth-and-roles.sql`:

```sql
-- ============================================================
-- Migration 005 — auth profiles, roles, order ownership
--
-- Run once in the Supabase SQL editor, AFTER migration-004-stock.sql.
--
-- Purely additive. It does not touch products, order_items, or any
-- seed block, so product stock is completely unaffected. Every
-- statement is idempotent; re-running it is a no-op.
-- ============================================================

-- ------------------------------------------------------------
-- Roles
-- ------------------------------------------------------------

do $$ begin
  create type public.user_role as enum ('customer', 'admin');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       public.user_role not null default 'customer',
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Row Level Security
-- Select-only, own row. No insert/update/delete policies exist, so
-- no client can ever write a role. The service role bypasses RLS,
-- which is how the Nitro routes read it.
-- ------------------------------------------------------------

alter table public.profiles enable row level security;

drop policy if exists "own profile is readable" on public.profiles;
create policy "own profile is readable"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

-- ------------------------------------------------------------
-- Signup trigger — creates the profile row and assigns the role.
-- security definer + empty search_path is Supabase's recommended
-- hardening, so every identifier below is fully qualified.
-- ------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case
      when lower(new.email) = 'schmidt@rhowerk.de' then 'admin'::public.user_role
      else 'customer'::public.user_role
    end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: the trigger only fires on insert, so give a profile to
-- any auth user that already exists.
insert into public.profiles (id, email, role)
select
  u.id,
  u.email,
  case
    when lower(u.email) = 'schmidt@rhowerk.de' then 'admin'::public.user_role
    else 'customer'::public.user_role
  end
from auth.users u
where u.email is not null
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- Order ownership
-- on delete set null, NOT cascade — deleting an account must never
-- erase order history, only orphan it.
-- No RLS policy is added: orders stay service-role-only.
-- ------------------------------------------------------------

alter table public.orders
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists orders_user_id_idx on public.orders (user_id);
```

- [ ] **Step 2: Run it in the Supabase SQL editor**

Open the hosted project → SQL Editor → paste the whole file → Run.

Expected: `Success. No rows returned.`

**Do not run any other file in `supabase/`.** `migration-004-stock.sql` contains a seed section that would reset every product's stock.

- [ ] **Step 3: Verify the schema landed**

In the SQL editor:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'orders' and column_name = 'user_id';

select tgname from pg_trigger where tgname = 'on_auth_user_created';
```

Expected: one `user_id` / `uuid` / `YES` row, and one `on_auth_user_created` row.

- [ ] **Step 4: Turn off email confirmation**

Supabase dashboard → Authentication → Providers → Email → **Confirm email: off** → Save.

This is project-level config on the hosted instance, so it applies to both PCs. Nothing to repeat on the second machine.

---

## Task 2: Types

**Files:**
- Modify: `app/types/shop.ts`

- [ ] **Step 1: Add the auth types**

Append to `app/types/shop.ts`:

```ts
export type UserRole = 'customer' | 'admin'

export interface Profile {
  id: string
  email: string
  role: UserRole
  created_at: string
}
```

- [ ] **Step 2: Add `user_id` to `Order`**

In the existing `Order` interface, directly below `country: string`, add:

```ts
  user_id: string | null
```

- [ ] **Step 3: Verify the app still boots**

There is no `typecheck` script in `package.json` and none should be added.

Run: `yarn dev`

Expected: the dev server starts and http://localhost:3000 renders. Type errors surface in the terminal as you touch the consuming files in later tasks.

---

## Task 3: Server auth utilities

**Files:**
- Create: `server/utils/auth.ts`

- [ ] **Step 1: Write the utility**

Create `server/utils/auth.ts`:

```ts
import type { H3Event } from 'h3'
import type { JwtPayload } from '@supabase/supabase-js'
import { serverSupabaseUser } from '#supabase/server'

/**
 * A signed-in person, normalised.
 *
 * serverSupabaseUser() hands back the verified JWT *claims*, not a row from
 * auth.users. Two traps live in that payload:
 *   - the user id is `sub`, not `id`
 *   - `role` is the Postgres role ('authenticated'), never our app role,
 *     which lives in public.profiles
 * JwtPayload also carries an index signature, so `claims.id` type-checks as
 * `any` and is undefined at runtime. Mapping to this narrow shape here means
 * no caller can reach for the wrong field.
 */
export interface SessionUser {
  id: string
  email: string | null
}

/**
 * The signed-in user, or null. Never throws — for routes where a
 * session is optional (guest checkout).
 */
export async function currentUser(event: H3Event): Promise<SessionUser | null> {
  let claims: JwtPayload | null = null
  try {
    claims = await serverSupabaseUser(event)
  } catch {
    return null
  }
  if (!claims?.sub) return null
  return { id: claims.sub, email: claims.email ?? null }
}

/** Any signed-in user, or 401. */
export async function requireUser(event: H3Event): Promise<SessionUser> {
  const user = await currentUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Not signed in' })
  return user
}

/**
 * A signed-in admin, or 401/403.
 * This is the real gate — the client-side role in useProfile() is
 * only ever used to decide what to render.
 */
export async function requireAdmin(event: H3Event): Promise<SessionUser> {
  const user = await requireUser(event)
  const { data, error } = await supabaseAdmin()
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (error || data?.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Admins only' })
  }
  return user
}
```

`supabaseAdmin` and `createError` are auto-imported inside `server/`, so they need no import statement — same as every existing server route.

`serverSupabaseUser` calls `client.auth.getClaims()`, which validates the JWT rather than trusting a cookie, so this is genuine verification.

> **Why the `SessionUser` mapping exists.** In `@nuxtjs/supabase` 2.0.10,
> `serverSupabaseUser` is typed `Promise<JwtPayload | null>` — *not* `User`.
> `JwtPayload` puts the user id on `sub` and has a `[key: string]: any` index
> signature, so a naive `user.id` compiles fine and is `undefined` at runtime.
> That would make `requireAdmin` query `.eq('id', undefined)`, match no row,
> and throw 403 for **every** caller including real admins. It fails closed, so
> there is no privilege leak — but nobody could reach the dashboard. Downstream
> tasks keep using `user.id` and `user.email`; this mapping is what makes those
> correct. Do not "simplify" it back to `User`.

- [ ] **Step 2: Verify it resolves**

Run: `yarn dev`

Expected: the dev server boots with no import or type errors mentioning `auth.ts` or `#supabase/server`.

---

## Task 4: Protect the admin routes

**Files:**
- Modify: `server/api/admin/orders.get.ts`
- Modify: `server/api/admin/orders/[id].patch.ts`

- [ ] **Step 1: Guard the list route**

Replace the whole body of `server/api/admin/orders.get.ts` with:

```ts
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const db = supabaseAdmin()
  const { data, error } = await db
    .from('orders')
    .select('*, order_items(*)')
    .order('created_at', { ascending: false })
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return data
})
```

The handler previously took no arguments; it now needs `event`.

- [ ] **Step 2: Guard the patch route**

In `server/api/admin/orders/[id].patch.ts`, make `requireAdmin` the very first statement in the handler — before `getRouterParam`, before `readBody`. The opening of the handler becomes:

```ts
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const id = getRouterParam(event, 'id')
  const body = await readBody<{ status?: string; reason?: string | null; note?: string | null }>(event)
```

Leave the rest of the file — validation, the `23514` mapping to a 409, the fire-and-forget mails — exactly as it is.

- [ ] **Step 3: Verify the lockout**

With `yarn dev` running, from a shell with no session cookie:

```bash
curl -i http://localhost:3000/api/admin/orders
```

Expected: `HTTP/1.1 401 Unauthorized` and a JSON body containing `Not signed in`. **Not** an array of orders.

- [ ] **Step 4: Confirm the admin page is now broken, on purpose**

Open http://localhost:3000/admin in a browser.

Expected: the order table fails to load. This is correct — Task 14 adds the redirect, and there is no way to sign in until Task 10. Do not "fix" it here.

---

## Task 5: Stamp `user_id` at checkout

**Files:**
- Modify: `server/api/orders.post.ts`

- [ ] **Step 1: Read the file first**

Run: `cat server/api/orders.post.ts`

You need to see the exact shape of the existing `.insert({ ... })` on `orders` before editing. Do not guess at the surrounding property names.

- [ ] **Step 2: Resolve the optional session**

Immediately after `const db = supabaseAdmin()`, add:

```ts
  // Optional — guest checkout stays supported. currentUser() never throws.
  const user = await currentUser(event)
```

- [ ] **Step 3: Add the column to the insert**

In the object passed to the `orders` `.insert({ ... })`, add one property alongside the existing customer fields:

```ts
    user_id: user?.id ?? null,
```

Change nothing else. In particular leave the stock pre-check and the `event.waitUntil(...)` confirmation mail untouched — stock is still decremented by the database trigger, never here.

- [ ] **Step 4: Verify a guest order still works**

With `yarn dev` running, place an order through http://localhost:3000/shop → cart → checkout, while signed out.

Expected: the confirmation page renders, and the mail appears in Mailpit at http://localhost:8025.

- [ ] **Step 5: Verify the column is null for guests**

In the Supabase SQL editor:

```sql
select order_number, user_id from public.orders order by created_at desc limit 1;
```

Expected: the order you just placed, with `user_id` null.

---

## Task 6: Account orders route

**Files:**
- Create: `server/api/account/orders.get.ts`

- [ ] **Step 1: Write the route**

Create `server/api/account/orders.get.ts`:

```ts
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = supabaseAdmin()
  const select = '*, order_items(*)'

  // Two queries rather than one PostgREST .or(): that filter is built by
  // string concatenation, so an email containing a comma or a parenthesis
  // would silently corrupt it.
  const [byUser, byEmail] = await Promise.all([
    db.from('orders').select(select).eq('user_id', user.id),
    user.email
      ? db.from('orders').select(select).eq('email', user.email)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (byUser.error) throw createError({ statusCode: 500, statusMessage: byUser.error.message })
  if (byEmail.error) throw createError({ statusCode: 500, statusMessage: byEmail.error.message })

  const merged = new Map<string, any>()
  for (const order of [...(byUser.data ?? []), ...(byEmail.data ?? [])]) {
    merged.set(order.id, order)
  }

  return [...merged.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
})
```

- [ ] **Step 2: Verify it rejects anonymous callers**

```bash
curl -i http://localhost:3000/api/account/orders
```

Expected: `HTTP/1.1 401 Unauthorized`, body contains `Not signed in`.

A signed-in check is not possible yet — Task 12 verifies the happy path.

---

## Task 7: Customer-facing status wording

**Files:**
- Modify: `shared/utils/shop.ts`

- [ ] **Step 1: Add the formatter**

Append to `shared/utils/shop.ts`, below `fmtPrice`:

```ts
/**
 * Customer-facing order status. Deliberately different wording from the
 * admin dashboard's STATUS map — it reuses the language the customer has
 * already been sent by mail ("confirmed", "on its way").
 */
export function customerOrderStatus(status: 'open' | 'marked' | 'canceled'): string {
  if (status === 'marked') return 'On its way'
  if (status === 'canceled') return 'Canceled'
  return 'Confirmed'
}
```

- [ ] **Step 2: Restart the dev server**

Stop `yarn dev` (Ctrl-C) and start it again.

This is not optional. Nuxt's auto-import watcher only watches paths under `app/`, so a new export in `shared/utils/` is invisible to a running dev server and you will get `customerOrderStatus is not defined` in Task 12.

---

## Task 8: Profile composable and sync plugin

**Files:**
- Create: `app/composables/useProfile.ts`
- Create: `app/plugins/profile.client.ts`

- [ ] **Step 1: Write the composable**

Create `app/composables/useProfile.ts`:

```ts
import type { Profile, UserRole } from '~/types/shop'

/**
 * The signed-in person's own profile row, read through the RLS
 * "own profile is readable" policy — the same way useShop() reads the
 * public catalog.
 *
 * This is for UI only: which menu items to render, where to send someone
 * after login. It is NEVER the gate. requireAdmin() in server/utils/auth.ts
 * is the real protection.
 */
export function useProfile() {
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()
  const profile = useState<Profile | null>('profile', () => null)

  async function fetchProfile(id: string): Promise<Profile | null> {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, role, created_at')
      .eq('id', id)
      .single()
    return (data as Profile | null) ?? null
  }

  /** Sync the cache with whoever is signed in right now. */
  async function refresh(): Promise<Profile | null> {
    profile.value = user.value ? await fetchProfile(user.value.id) : null
    return profile.value
  }

  /**
   * Load for an explicit id. Used immediately after signIn/signUp, when the
   * reactive user ref has not caught up with the new session yet.
   */
  async function loadFor(id: string): Promise<Profile | null> {
    profile.value = await fetchProfile(id)
    return profile.value
  }

  const role = computed<UserRole | null>(() => profile.value?.role ?? null)
  const isAdmin = computed(() => role.value === 'admin')
  /** Where this person belongs after signing in. */
  const landingPath = computed(() => (isAdmin.value ? '/admin' : '/account'))

  return { profile, role, isAdmin, landingPath, refresh, loadFor }
}
```

- [ ] **Step 2: Write the sync plugin**

Create `app/plugins/profile.client.ts`:

```ts
/**
 * Keeps the cached profile in step with the auth session, so the header
 * knows the role on every page — including pages with no middleware.
 * Mirrors the existing app/plugins/cart.client.ts pattern.
 */
export default defineNuxtPlugin(() => {
  const user = useSupabaseUser()
  const { profile, refresh } = useProfile()

  watch(
    user,
    async (value) => {
      if (!value) {
        profile.value = null
        return
      }
      if (profile.value?.id === value.id) return
      await refresh()
    },
    { immediate: true },
  )
})
```

- [ ] **Step 3: Verify the app still boots**

Run: `yarn dev`, open http://localhost:3000

Expected: the homepage renders normally, no console errors. Nothing visible changes yet.

---

## Task 9: Route middleware

**Files:**
- Create: `app/middleware/auth.ts`
- Create: `app/middleware/admin.ts`

- [ ] **Step 1: Session guard**

Create `app/middleware/auth.ts`:

```ts
export default defineNuxtRouteMiddleware(() => {
  const user = useSupabaseUser()
  if (!user.value) return navigateTo('/login')
})
```

- [ ] **Step 2: Admin guard**

Create `app/middleware/admin.ts`:

```ts
export default defineNuxtRouteMiddleware(async () => {
  const user = useSupabaseUser()
  const { profile, refresh, isAdmin } = useProfile()

  // Non-admins — signed out or merely a customer — are sent to the storefront
  // rather than /login, so the dashboard's existence is not advertised.
  if (!user.value) return navigateTo('/')

  // `sub`, not `id` — useSupabaseUser() returns JWT claims (see Task 3)
  if (profile.value?.id !== user.value.sub) await refresh()
  if (!isAdmin.value) return navigateTo('/')
})
```

- [ ] **Step 3: Verify nothing regressed**

Run: `yarn dev`, open http://localhost:3000

Expected: normal render. The middlewares are not attached to any page yet — Tasks 12 and 14 do that.

---

## Task 10: Login page

**Files:**
- Create: `app/pages/login.vue`

- [ ] **Step 1: Write the page**

Create `app/pages/login.vue`:

```vue
<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const { loadFor, landingPath } = useProfile()

useHead({ title: 'Log in — Ember & Oak' })

const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

// already signed in — bounce to wherever this role belongs.
// `sub`, not `id` — useSupabaseUser() returns JWT claims (see Task 3).
onMounted(async () => {
  if (user.value) {
    await loadFor(user.value.sub)
    await navigateTo(landingPath.value)
  }
})

async function submit() {
  if (busy.value) return
  error.value = null
  busy.value = true

  // The Supabase SDK RETURNS an error object rather than throwing an h3
  // error, so this is error.message — not the e.data.statusMessage shape
  // used for our own API routes.
  const { data, error: authError } = await supabase.auth.signInWithPassword({
    email: email.value.trim(),
    password: password.value,
  })
  busy.value = false

  if (authError || !data.user) {
    error.value = authError?.message ?? 'Could not sign you in.'
    return
  }

  await loadFor(data.user.id)
  await navigateTo(landingPath.value)
}

const inputClass =
  'h-[50px] w-full rounded-[10px] border border-line bg-cream px-4 text-[15px] outline-none transition-colors focus:border-terra focus:border-2 focus:bg-white'
</script>

<template>
  <div class="mx-auto w-full max-w-[440px] px-5 py-14 md:py-20">
    <h1 class="text-center font-display text-[30px] md:text-[34px] font-semibold">Welcome back</h1>
    <p class="mt-2 text-center text-[15px] text-muted">Sign in to see your orders.</p>

    <div class="card mt-8 p-6 md:p-8">
      <form class="space-y-5" novalidate @submit.prevent="submit">
        <div>
          <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="email">EMAIL</label>
          <input id="email" v-model="email" type="email" autocomplete="email" :class="inputClass">
        </div>

        <div>
          <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="password">PASSWORD</label>
          <input id="password" v-model="password" type="password" autocomplete="current-password" :class="inputClass">
        </div>

        <p v-if="error" class="text-[13px] text-status-canceled">{{ error }}</p>

        <button type="submit" class="btn-primary w-full" :disabled="busy">
          {{ busy ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </div>

    <p class="mt-6 text-center text-[15px] text-muted">
      No account yet?
      <NuxtLink to="/register" class="font-medium text-terra hover:underline">Create one</NuxtLink>
    </p>
  </div>
</template>
```

- [ ] **Step 2: Verify it renders**

Open http://localhost:3000/login

Expected: the card renders inside the normal store header and footer. Submitting with a made-up address shows a red Supabase message such as `Invalid login credentials` — there are no accounts yet.

---

## Task 11: Registration page

**Files:**
- Create: `app/pages/register.vue`

- [ ] **Step 1: Write the page**

Create `app/pages/register.vue`:

```vue
<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const { loadFor, landingPath } = useProfile()

useHead({ title: 'Create account — Ember & Oak' })

const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

// `sub`, not `id` — useSupabaseUser() returns JWT claims (see Task 3)
onMounted(async () => {
  if (user.value) {
    await loadFor(user.value.sub)
    await navigateTo(landingPath.value)
  }
})

async function submit() {
  if (busy.value) return
  error.value = null

  if (password.value.length < 6) {
    error.value = 'Password must be at least 6 characters.'
    return
  }

  busy.value = true
  // Confirm-email is off on this project, so signUp returns a live session
  // and we can route straight on. Same SDK error shape as login.
  const { data, error: authError } = await supabase.auth.signUp({
    email: email.value.trim(),
    password: password.value,
  })
  busy.value = false

  if (authError || !data.user) {
    error.value = authError?.message ?? 'Could not create your account.'
    return
  }

  await loadFor(data.user.id)
  await navigateTo(landingPath.value)
}

const inputClass =
  'h-[50px] w-full rounded-[10px] border border-line bg-cream px-4 text-[15px] outline-none transition-colors focus:border-terra focus:border-2 focus:bg-white'
</script>

<template>
  <div class="mx-auto w-full max-w-[440px] px-5 py-14 md:py-20">
    <h1 class="text-center font-display text-[30px] md:text-[34px] font-semibold">Create your account</h1>
    <p class="mt-2 text-center text-[15px] text-muted">So your orders have somewhere to live.</p>

    <div class="card mt-8 p-6 md:p-8">
      <form class="space-y-5" novalidate @submit.prevent="submit">
        <div>
          <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="email">EMAIL</label>
          <input id="email" v-model="email" type="email" autocomplete="email" :class="inputClass">
        </div>

        <div>
          <label class="mono-label mb-2 block text-[10px] font-medium text-muted" for="password">PASSWORD</label>
          <input id="password" v-model="password" type="password" autocomplete="new-password" :class="inputClass">
          <p class="mt-1.5 text-[13px] text-muted">At least 6 characters.</p>
        </div>

        <p v-if="error" class="text-[13px] text-status-canceled">{{ error }}</p>

        <button type="submit" class="btn-primary w-full" :disabled="busy">
          {{ busy ? 'Creating…' : 'Create account' }}
        </button>
      </form>
    </div>

    <p class="mt-6 text-center text-[15px] text-muted">
      Already have one?
      <NuxtLink to="/login" class="font-medium text-terra hover:underline">Sign in</NuxtLink>
    </p>
  </div>
</template>
```

- [ ] **Step 2: Register the admin account**

Open http://localhost:3000/register and sign up as **schmidt@rhowerk.de** with a password you will remember.

Expected: you are redirected to `/admin`. The page may still error on data — Task 14 has not run yet, so the browser has a session but `admin.vue` has no guard. That is fine.

- [ ] **Step 3: Verify the role landed**

In the Supabase SQL editor:

```sql
select email, role from public.profiles;
```

Expected: one row, `schmidt@rhowerk.de`, role `admin`.

- [ ] **Step 4: Register a customer**

Sign out is not built yet, so use a private/incognito window. Register `test-customer@example.com`.

Expected: redirected to `/account`, which 404s for now (Task 12 creates it). Re-run the query above — the new row must have role `customer`.

- [ ] **Step 5: Verify the admin API now works for the admin**

In the normal (non-incognito) window, with the admin session, open http://localhost:3000/api/admin/orders

Expected: the JSON order array. In the incognito customer window the same URL must return a 403 `Admins only`.

---

## Task 12: Account page

**Files:**
- Create: `app/pages/account.vue`

- [ ] **Step 1: Write the page**

Create `app/pages/account.vue`:

```vue
<script setup lang="ts">
import type { Order } from '~/types/shop'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'My account — Ember & Oak' })

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const { profile } = useProfile()

const { data: ordersData, pending } = await useFetch<Order[]>('/api/account/orders')
const orders = computed(() => ordersData.value ?? [])

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

const STATUS_CLASS: Record<Order['status'], string> = {
  open: 'bg-status-open-bg text-status-open-text',
  marked: 'bg-status-marked-bg text-status-marked-text',
  canceled: 'bg-status-canceled-bg text-status-canceled-text',
}

async function signOut() {
  await supabase.auth.signOut()
  profile.value = null
  await navigateTo('/')
}
</script>

<template>
  <div class="mx-auto w-full max-w-[860px] px-5 py-12 md:py-16">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="mono-label text-[10px] font-medium text-muted">MY ACCOUNT</p>
        <h1 class="mt-2 font-display text-[30px] md:text-[34px] font-semibold">
          {{ user?.email }}
        </h1>
      </div>
      <button class="btn-ghost-light" @click="signOut">Sign out</button>
    </div>

    <h2 class="mt-10 font-display text-[22px] font-semibold">Your orders</h2>

    <p v-if="pending" class="mt-6 text-[15px] text-muted">Loading your orders…</p>

    <div v-else-if="orders.length === 0" class="card mt-5 px-6 py-10 text-center">
      <p class="text-[15px] text-muted">No orders yet.</p>
      <NuxtLink to="/shop" class="btn-primary mt-5">Browse the shop</NuxtLink>
    </div>

    <div v-else class="mt-5 space-y-4">
      <article v-for="order in orders" :key="order.id" class="card p-5 md:p-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="mono-label text-[11px] font-medium">{{ order.order_number }}</p>
            <p class="mt-1 text-[13px] text-muted">{{ fmtDate(order.created_at) }}</p>
          </div>
          <span
            class="rounded-full px-3 py-1 text-[12px] font-semibold"
            :class="STATUS_CLASS[order.status]"
          >
            {{ customerOrderStatus(order.status) }}
          </span>
        </div>

        <ul class="mt-4 space-y-1.5 border-t border-line pt-4">
          <li
            v-for="item in order.order_items"
            :key="item.id"
            class="flex justify-between gap-4 text-[14px]"
          >
            <span>{{ item.quantity }} × {{ item.product_name }}</span>
            <span class="shrink-0 text-muted">{{ fmtPrice(item.quantity * item.unit_price_cents) }}</span>
          </li>
        </ul>

        <div class="mt-4 flex justify-between border-t border-line pt-3.5 text-[15px] font-semibold">
          <span>Total</span>
          <span>{{ fmtPrice(order.total_cents) }}</span>
        </div>
      </article>
    </div>
  </div>
</template>
```

`fmtPrice` and `customerOrderStatus` come from `shared/utils/shop.ts` and are auto-imported — no import statement.

- [ ] **Step 2: Verify the signed-out redirect**

In a private window with no session, open http://localhost:3000/account

Expected: redirected to `/login`.

- [ ] **Step 3: Verify the order history**

Signed in as the admin account, open http://localhost:3000/account

Expected: the page renders with your email. Orders appear only if any match — probably none yet.

- [ ] **Step 4: Verify the `user_id` path end to end**

Still signed in, place a real order through the shop. Then reload `/account`.

Expected: the new order appears, status pill reads **Confirmed**, the total matches, and the mail is in Mailpit.

- [ ] **Step 5: Verify the email fallback**

In the SQL editor, point one seeded order at your account's address:

```sql
update public.orders
set email = 'schmidt@rhowerk.de'
where order_number = (select order_number from public.orders where user_id is null order by created_at limit 1);
```

Reload `/account`.

Expected: that older order now appears too, even though its `user_id` is null. Confirms the fallback branch of Task 6.

---

## Task 13: Header account menu

**Files:**
- Create: `app/components/AccountMenu.vue`
- Modify: `app/components/StoreHeader.vue`

- [ ] **Step 1: Write the dropdown**

Create `app/components/AccountMenu.vue`:

```vue
<script setup lang="ts">
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const { profile, isAdmin } = useProfile()
const route = useRoute()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

watch(() => route.fullPath, () => { open.value = false })

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})

async function signOut() {
  open.value = false
  await supabase.auth.signOut()
  profile.value = null
  await navigateTo('/')
}

const itemClass =
  'block w-full px-4 py-2.5 text-left text-sm text-espresso transition-colors hover:bg-cream-alt'
</script>

<template>
  <div ref="root" class="relative">
    <button
      class="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:text-ember"
      :aria-expanded="open"
      aria-haspopup="true"
      aria-label="Account"
      @click="open = !open"
    >
      <Icon name="User" :size="22" color="#EFE4D8" :stroke-width="2" />
    </button>

    <Transition name="acct">
      <div
        v-if="open"
        class="absolute right-0 top-[calc(100%+8px)] z-50 w-[236px] overflow-hidden rounded-xl border border-line bg-white py-1.5 shadow-lg"
      >
        <template v-if="user">
          <p class="truncate border-b border-line px-4 pb-2.5 pt-1.5 text-[13px] text-muted">
            {{ user.email }}
          </p>
          <NuxtLink to="/account" :class="itemClass">My orders</NuxtLink>
          <NuxtLink v-if="isAdmin" to="/admin" :class="itemClass">Admin dashboard</NuxtLink>
          <div class="my-1.5 border-t border-line" />
          <button :class="itemClass" @click="signOut">Sign out</button>
        </template>

        <template v-else>
          <NuxtLink to="/login" :class="itemClass">Log in</NuxtLink>
          <NuxtLink to="/register" :class="itemClass">Create account</NuxtLink>
        </template>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.acct-enter-active, .acct-leave-active { transition: opacity 0.15s ease-out, transform 0.15s ease-out; }
.acct-enter-from, .acct-leave-to { opacity: 0; transform: translateY(-4px); }

@media (prefers-reduced-motion: reduce) {
  .acct-enter-active, .acct-leave-active { transition: opacity 0.12s; }
  .acct-enter-from, .acct-leave-to { transform: none; }
}
</style>
```

- [ ] **Step 2: Mount it on the desktop nav**

In `app/components/StoreHeader.vue`, inside the desktop `<nav class="hidden lg:flex items-center gap-8">`, add `<AccountMenu />` immediately **before** the existing Cart `<button>`:

```vue
        <AccountMenu />
        <button
          class="flex items-center gap-2.5 rounded-full border border-[#EFE4D8]/32 px-[17px] py-[9px] text-sm font-medium text-[#EFE4D8] transition-colors hover:border-ember hover:text-ember"
          @click="cart.drawerOpen = true"
        >
```

- [ ] **Step 3: Add the same items to the mobile menu**

In the same file, in the mobile full-screen `<nav class="relative flex grow flex-col justify-center px-8 pb-16">`, add a section after the existing THE SHELVES block, directly before the closing `</nav>`:

```vue
          <p class="mono-label mt-10 text-[10px] font-medium text-[#EFE4D8]/50">ACCOUNT</p>
          <div class="mt-3 flex flex-col items-start">
            <template v-if="user">
              <NuxtLink to="/account" class="py-2 text-[17px] font-medium text-[#EFE4D8]/85">My orders</NuxtLink>
              <NuxtLink v-if="isAdmin" to="/admin" class="py-2 text-[17px] font-medium text-[#EFE4D8]/85">Admin dashboard</NuxtLink>
              <button class="py-2 text-[17px] font-medium text-[#EFE4D8]/85" @click="signOutFromMenu">Sign out</button>
            </template>
            <template v-else>
              <NuxtLink to="/login" class="py-2 text-[17px] font-medium text-[#EFE4D8]/85">Log in</NuxtLink>
              <NuxtLink to="/register" class="py-2 text-[17px] font-medium text-[#EFE4D8]/85">Create account</NuxtLink>
            </template>
          </div>
```

- [ ] **Step 4: Add the state the mobile section needs**

In the `<script setup>` of `StoreHeader.vue`, below the existing `const batch = batchInfo()`, add:

```ts
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const { profile, isAdmin } = useProfile()

async function signOutFromMenu() {
  menuOpen.value = false
  await supabase.auth.signOut()
  profile.value = null
  await navigateTo('/')
}
```

- [ ] **Step 5: Verify both breakpoints**

Open http://localhost:3000 signed out.

Expected desktop: a user icon left of the Cart pill; clicking it shows "Log in" and "Create account". Clicking elsewhere or pressing Escape closes it.

Expected mobile (narrow the window below `lg`): the burger menu has an ACCOUNT section with the same two links.

- [ ] **Step 6: Verify the signed-in menu**

Sign in as the admin account and reopen the menu.

Expected: your email, "My orders", "Admin dashboard", "Sign out". Signed in as `test-customer@example.com`, the "Admin dashboard" entry must be **absent**.

- [ ] **Step 7: Verify sign out**

Click "Sign out".

Expected: you land on `/`, and the menu falls back to "Log in" / "Create account".

---

## Task 14: Guard the admin dashboard

**Files:**
- Modify: `app/pages/admin.vue`

- [ ] **Step 1: Attach the middleware**

In `app/pages/admin.vue`, change the existing page meta from:

```ts
definePageMeta({ layout: false })
```

to:

```ts
definePageMeta({ layout: false, middleware: 'admin' })
```

- [ ] **Step 2: Add sign-out state**

In the same `<script setup>`, below the `useFetch` call, add:

```ts
const supabase = useSupabaseClient()
const { profile } = useProfile()

async function signOut() {
  await supabase.auth.signOut()
  profile.value = null
  await navigateTo('/')
}
```

- [ ] **Step 3: Add the sign-out control**

`admin.vue` sets `layout: false`, so there is no store header to hang this off.

Locate the anchor: `grep -n "todayLabel" app/pages/admin.vue` — the second hit is the `<p>` at the end of the dashboard's dark header row. Replace that `<p>` block:

```vue
        <p class="mono-label text-[10px] text-[#EFE4D8]/55">
          {{ todayLabel }} · {{ thisWeek.length }} ORDERS THIS WEEK
        </p>
```

with the same paragraph wrapped alongside a sign-out button:

```vue
        <div class="flex items-center gap-5">
          <p class="mono-label text-[10px] text-[#EFE4D8]/55">
            {{ todayLabel }} · {{ thisWeek.length }} ORDERS THIS WEEK
          </p>
          <button class="btn-ghost-dark h-9 px-5 text-sm" @click="signOut">Sign out</button>
        </div>
```

Use `btn-ghost-dark`, **not** `btn-ghost-light` — this row sits on the espresso band, and the light variant has a white background that would look like a misplaced card. The height and padding overrides shrink the default 52px pill to suit a header row.

- [ ] **Step 4: Verify the customer lockout**

Signed in as `test-customer@example.com`, open http://localhost:3000/admin

Expected: redirected to `/`. The order table never renders.

- [ ] **Step 5: Verify the signed-out lockout**

In a private window, open http://localhost:3000/admin

Expected: redirected to `/`.

- [ ] **Step 6: Verify admin access still works**

Signed in as `schmidt@rhowerk.de`, open http://localhost:3000/admin

Expected: the dashboard renders with the order list, and the sign-out button is visible.

- [ ] **Step 7: Verify a status change still works end to end**

Set an open order to marked.

Expected: the row updates optimistically, and the "on its way" mail lands in Mailpit. Reload `/account` on the customer side if that order belongs to a customer — the pill must read **On its way**.

---

## Task 15: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Retire the stale gap in CLAUDE.md**

In the `## Project` section, the **Admin** bullet currently ends:

> These routes have **no authentication** — a known, accepted gap for a localhost project.

Replace that sentence with:

```markdown
  These routes are guarded by `requireAdmin()` from `server/utils/auth.ts`.
```

- [ ] **Step 2: Document auth in CLAUDE.md**

Add a new section after the `## Mail` section:

```markdown
## Auth and roles

Email/password through `@nuxtjs/supabase`. Roles live in `public.profiles`
(`migration-005-auth-and-roles.sql`), created by a trigger on `auth.users`
insert that assigns `admin` to `schmidt@rhowerk.de` and `customer` to everyone
else.

- `server/utils/auth.ts` — `currentUser()` (never throws, for guest checkout),
  `requireUser()` (401), `requireAdmin()` (403). **This is the only gate.**
  `useProfile()` on the client decides what to render, never what is allowed.
- Guest checkout still works. `orders.user_id` is stamped when a signed-in
  person checks out; `/api/account/orders` also falls back to matching the
  account email, so guest orders surface once you register with that address.
- **Signup email confirmation is off** (Supabase dashboard setting). That makes
  the email fallback trust-on-assertion — registering as someone else's address
  would show their orders. Accepted for a fake localhost shop; turning
  confirmation on closes it with no code change.
- Supabase is hosted, so its auth mails can never reach the local Mailpit
  container. Only the order mails in `server/utils/email/` go through Mailpit.
```

- [ ] **Step 3: Update the migration list in CLAUDE.md**

In the `## Project` → **Data** bullet, the ordered list of SQL files ends at
`migration-004-stock.sql` and says **All four are already applied**. Change it
to list `migration-005-auth-and-roles.sql` as the fifth file, and reword the
count to **All five are already applied**. Keep the existing warning that 004's
seed section would reset every product's stock.

- [ ] **Step 4: Update the README**

In the README's setup / migration section, add `migration-005-auth-and-roles.sql`
as the fifth file to run in the Supabase SQL editor, and add a short **Accounts**
subsection recording:

- Register at `/register`; `schmidt@rhowerk.de` becomes admin automatically.
- Everyone else is a customer and lands on `/account`.
- Supabase dashboard → Authentication → Providers → Email → **Confirm email: off**.
- This is shared hosted-project config, so it does **not** need redoing on the
  second machine. No new `.env` keys are introduced.

- [ ] **Step 5: Verify the docs match reality**

Re-read the changed sections against the code.

Expected: no reference to unauthenticated admin routes survives, and the SQL file list matches `ls supabase/`.

---

## Final verification

Run through this in one pass, with `yarn dev` running and Mailpit up (`docker compose up -d`).

- [ ] Signed out: `curl -i http://localhost:3000/api/admin/orders` → **401**
- [ ] Signed out: `curl -i http://localhost:3000/api/account/orders` → **401**
- [ ] Signed out: `/admin` in a browser → redirected to `/`
- [ ] Signed out: `/account` in a browser → redirected to `/login`
- [ ] Signed in as customer: `/api/admin/orders` in the browser → **403 Admins only**
- [ ] Signed in as customer: `/admin` → redirected to `/`; header menu has no "Admin dashboard"
- [ ] Signed in as admin: `/admin` renders, status changes work, mail lands in Mailpit
- [ ] Checkout while signed in → order carries `user_id`, appears on `/account`
- [ ] Checkout while signed out → order still placed, `user_id` null, confirmation mail sent
- [ ] `/account` shows a `marked` order as **On its way**, an `open` one as **Confirmed**
- [ ] Product stock unchanged except through the database triggers:
      `select slug, stock from public.products order by slug;` matches what it
      was before this work, minus only genuine new orders
- [ ] `git status` shows only intended files — **nothing is committed**
