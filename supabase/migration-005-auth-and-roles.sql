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
