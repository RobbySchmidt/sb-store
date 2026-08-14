-- ============================================================
-- Ember & Oak — store schema, security & seed data
-- Run this once in the Supabase SQL editor (or via psql).
-- Safe to re-run: drops existing store tables first.
-- After this file, also run migration-002-meta-and-orders.sql
-- (product meta values + sample orders for the admin page).
-- ============================================================

drop table if exists public.order_items;
drop table if exists public.orders;
drop table if exists public.products;
drop table if exists public.categories;
drop type if exists public.order_status;
drop sequence if exists public.order_number_seq;

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

create table public.products (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.categories(id) on delete restrict,
  name         text not null,
  slug         text not null unique,
  tagline      text,
  description  text,
  price_cents  int  not null check (price_cents >= 0),
  image_url    text,
  is_active    boolean not null default true,
  meta         jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create index products_category_id_idx on public.products (category_id);

create type public.order_status as enum ('open', 'marked', 'canceled');

create sequence public.order_number_seq start with 840;

create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  order_number    text not null unique
                    default 'EO-' || to_char(now(), 'YYYY') || '-' ||
                            lpad(nextval('public.order_number_seq')::text, 4, '0'),
  status          public.order_status not null default 'open',
  customer_name   text not null,
  email           text not null,
  street          text not null,
  zip             text not null,
  city            text not null,
  country         text not null,
  subtotal_cents  int not null check (subtotal_cents >= 0),
  shipping_cents  int not null check (shipping_cents >= 0),
  total_cents     int not null check (total_cents >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index orders_status_idx on public.orders (status);
create index orders_created_at_idx on public.orders (created_at desc);

-- product data is snapshotted onto the item so orders stay intact
-- even if a product is renamed, repriced, or deleted later
create table public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders(id) on delete cascade,
  product_id        uuid references public.products(id) on delete set null,
  product_name      text not null,
  unit_price_cents  int  not null check (unit_price_cents >= 0),
  quantity          int  not null check (quantity > 0)
);

create index order_items_order_id_idx on public.order_items (order_id);

-- keep orders.updated_at fresh on status changes
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- Row Level Security
-- Catalog is publicly readable; orders are only reachable via
-- the service role (Nuxt server routes) — no anon policies.
-- ------------------------------------------------------------

alter table public.categories  enable row level security;
alter table public.products    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

create policy "categories are publicly readable"
  on public.categories for select
  to anon, authenticated
  using (true);

create policy "active products are publicly readable"
  on public.products for select
  to anon, authenticated
  using (is_active);

-- ------------------------------------------------------------
-- Seed data
-- ------------------------------------------------------------

insert into public.categories (name, slug, sort_order) values
  ('Coffee',      'coffee',      1),
  ('Pantry',      'pantry',      2),
  ('Accessories', 'accessories', 3);

insert into public.products (category_id, name, slug, tagline, description, price_cents)
values
  ((select id from public.categories where slug = 'coffee'),
   'Ember Blend – Dark Roast 250g', 'ember-blend-dark-roast',
   'Smoky, chocolatey, unapologetic.',
   'Our signature dark roast. A blend of Brazilian and Sumatran beans roasted deep into the second crack — notes of dark chocolate, toasted hazelnut and a whisper of smoke. Built for espresso, brave enough for filter.',
   1490),
  ((select id from public.categories where slug = 'coffee'),
   'Sunrise Single Origin – Ethiopia 250g', 'sunrise-single-origin-ethiopia',
   'Bright, floral, wide awake.',
   'A washed heirloom lot from Yirgacheffe. Expect jasmine, bergamot and a juicy peach sweetness. Light roast, best enjoyed as a slow pour-over on a quiet morning.',
   1650),
  ((select id from public.categories where slug = 'coffee'),
   'House Espresso – Classic 500g', 'house-espresso-classic',
   'The daily workhorse.',
   'Balanced and dependable: caramel sweetness, low acidity, a thick crema. The blend our own machines run on from open to close.',
   1990),
  ((select id from public.categories where slug = 'coffee'),
   'Midnight Decaf – Swiss Water 250g', 'midnight-decaf-swiss-water',
   'All the ritual, none of the buzz.',
   'A Colombian lot decaffeinated chemical-free with the Swiss Water process. Cocoa, red apple and brown sugar — proof that decaf deserves respect too.',
   1350),
  ((select id from public.categories where slug = 'pantry'),
   'Honey Almond Granola 500g', 'honey-almond-granola',
   'Breakfast, upgraded.',
   'Slow-baked oats with roasted almonds, wildflower honey and a pinch of sea salt. Crunchy clusters that survive the milk.',
   850),
  ((select id from public.categories where slug = 'pantry'),
   '70% Dark Cacao Bar', 'dark-cacao-bar-70',
   'Single-origin. Seriously dark.',
   'Stone-ground Ecuadorian cacao, 70% and nothing to hide. Fruity depth with a clean snap — the natural companion to a dark roast.',
   690),
  ((select id from public.categories where slug = 'pantry'),
   'Oat Milk Syrup – Vanilla', 'oat-milk-syrup-vanilla',
   'Your latte''s best friend.',
   'A silky vanilla syrup developed for oat milk drinks. Real Bourbon vanilla, no artificial aftertaste, dissolves instantly in hot or iced drinks.',
   750),
  ((select id from public.categories where slug = 'pantry'),
   'Wildflower Honey 350g', 'wildflower-honey',
   'From hives we know by name.',
   'Raw, unfiltered wildflower honey from a small apiary in the foothills. Creamy texture, herbal finish — stir it into tea or eat it off the spoon, we won''t judge.',
   990),
  ((select id from public.categories where slug = 'accessories'),
   'Ceramic Pour-Over Dripper', 'ceramic-pour-over-dripper',
   'Slow coffee, done right.',
   'A matte ceramic V-cone dripper with spiral ribs for an even extraction. Fits size 02 filters and sits happily on any mug or server.',
   2400),
  ((select id from public.categories where slug = 'accessories'),
   'Paper Filters Size 02 (100 pcs)', 'paper-filters-02',
   'The unsung heroes.',
   'One hundred oxygen-bleached size 02 filters. Rinse, brew, compost, repeat.',
   450),
  ((select id from public.categories where slug = 'accessories'),
   'Ember & Oak Ceramic Mug', 'ember-oak-ceramic-mug',
   'Your new favourite mug.',
   'A 300ml stoneware mug in warm cream with our terracotta stamp. Thick walls keep the heat in, the wide handle keeps your fingers out of trouble.',
   1800),
  ((select id from public.categories where slug = 'accessories'),
   'Glass Carafe Brewer 600ml', 'glass-carafe-brewer',
   'Brew it slow, serve it pretty.',
   'A hand-blown borosilicate glass carafe with a natural wood collar and leather tie. Brews up to three cups of clean, sediment-free filter coffee — and looks good doing it.',
   3400);
