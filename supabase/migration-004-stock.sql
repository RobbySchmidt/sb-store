-- ============================================================
-- Migration 004 — product stock
--
-- The invariant: stock is held while an order is not canceled.
--   creating an order's lines takes stock
--   canceling gives it back
--   un-canceling takes it again
--
-- The schema and trigger sections are safe to re-run.
-- The SEED section is NOT — running it again resets every
-- product's stock to the starting numbers.
-- ============================================================

-- ------------------------------------------------------------
-- Column + the guard that makes the whole design work
-- ------------------------------------------------------------

alter table public.products
  add column if not exists stock int not null default 0;

-- no race, however unlucky, can drive stock below zero
alter table public.products
  drop constraint if exists products_stock_non_negative;
alter table public.products
  add constraint products_stock_non_negative check (stock >= 0);

-- ------------------------------------------------------------
-- Stock movement
-- ------------------------------------------------------------

-- take stock when an order's lines are created.
-- supabase-js inserts all lines in one statement, so this is one
-- transaction: every line decrements, or the check constraint
-- aborts the whole insert and none of them do.
create or replace function public.take_stock_for_item()
returns trigger language plpgsql as $$
begin
  update public.products
     set stock = stock - new.quantity
   where id = new.product_id;
  return new;
end $$;

drop trigger if exists order_items_take_stock on public.order_items;
create trigger order_items_take_stock
  after insert on public.order_items
  for each row execute function public.take_stock_for_item();

-- move a whole order's quantities in one direction:
--   p_sign =  1  give stock back
--   p_sign = -1  take it again
create or replace function public.apply_order_stock(p_order uuid, p_sign int)
returns void language plpgsql as $$
begin
  update public.products p
     set stock = p.stock + (p_sign * s.qty)
    from (
      select oi.product_id, sum(oi.quantity) as qty
        from public.order_items oi
       where oi.order_id = p_order
         and oi.product_id is not null
       group by oi.product_id
    ) s
   where p.id = s.product_id;
end $$;

-- keyed on the TRANSITION, not the value — which is what makes it
-- idempotent: re-clicking Cancel on an already canceled order is
-- not a transition, so nothing moves.
create or replace function public.sync_stock_on_status()
returns trigger language plpgsql as $$
begin
  if new.status = 'canceled' and old.status <> 'canceled' then
    perform public.apply_order_stock(new.id, 1);
  elsif old.status = 'canceled' and new.status <> 'canceled' then
    perform public.apply_order_stock(new.id, -1);
  end if;
  return new;
end $$;

drop trigger if exists orders_sync_stock on public.orders;
create trigger orders_sync_stock
  after update of status on public.orders
  for each row execute function public.sync_stock_on_status();

-- ------------------------------------------------------------
-- SEED — one time only. Re-running resets every product's stock.
-- A spread so the normal / low / out-of-stock cards are all
-- visible without having to place test orders first.
-- ------------------------------------------------------------

update public.products set stock = v.stock
from (values
  ('ember-blend-dark-roast',        18),
  ('sunrise-single-origin-ethiopia', 11),
  ('house-espresso-classic',        25),
  ('midnight-decaf-swiss-water',    12),
  ('honey-almond-granola',          30),
  ('dark-cacao-bar-70',              0),   -- out of stock
  ('oat-milk-syrup-vanilla',         9),
  ('wildflower-honey',               3),   -- low
  ('ceramic-pour-over-dripper',      7),
  ('paper-filters-02',              40),
  ('ember-oak-ceramic-mug',         15),
  ('glass-carafe-brewer',            2)    -- low
) as v(slug, stock)
where products.slug = v.slug;

-- the eight demo orders already exist and were never charged against
-- stock. Every non-canceled one is holding its items, so subtract them
-- to satisfy the invariant from the start — otherwise canceling a demo
-- order would hand back stock that was never taken.
update public.products p
   set stock = greatest(p.stock - s.qty, 0)
  from (
    select oi.product_id, sum(oi.quantity) as qty
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where o.status <> 'canceled'
       and oi.product_id is not null
     group by oi.product_id
  ) s
 where p.id = s.product_id;
