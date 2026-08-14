-- ============================================================
-- Migration 002 — product meta, EO-YYYY-NNNN order numbers,
-- sample orders for the admin dashboard
-- ============================================================

-- product meta: meta line, roast profile (0-100), flavor chips
alter table public.products add column if not exists meta jsonb not null default '{}';

update public.products set meta = v.meta::jsonb
from (values
  ('ember-blend-dark-roast',        '{"weight_g":250,"meta_line":"250 G · WHOLE BEAN · BLEND · BRAZIL + SUMATRA","roast_pct":88,"flavors":["Dark chocolate","Hazelnut","Smoke"]}'),
  ('sunrise-single-origin-ethiopia','{"weight_g":250,"meta_line":"250 G · WHOLE BEAN · WASHED · YIRGACHEFFE","roast_pct":26,"flavors":["Jasmine","Bergamot","Honeydew"]}'),
  ('house-espresso-classic',        '{"weight_g":500,"meta_line":"500 G · WHOLE BEAN · BLEND · ESPRESSO","roast_pct":72,"flavors":["Caramel","Cocoa","Thick crema"]}'),
  ('midnight-decaf-swiss-water',    '{"weight_g":250,"meta_line":"250 G · WHOLE BEAN · SWISS WATER · COLOMBIA","roast_pct":55,"flavors":["Cocoa","Red apple","Brown sugar"]}'),
  ('honey-almond-granola',          '{"weight_g":500,"meta_line":"500 G · SLOW-BAKED · OATS + ALMONDS"}'),
  ('dark-cacao-bar-70',             '{"weight_g":100,"meta_line":"100 G · STONE-GROUND · ECUADOR · 70%"}'),
  ('oat-milk-syrup-vanilla',        '{"meta_line":"250 ML · BOURBON VANILLA · FOR OAT DRINKS"}'),
  ('wildflower-honey',              '{"weight_g":350,"meta_line":"350 G · RAW · UNFILTERED · SMALL APIARY"}'),
  ('ceramic-pour-over-dripper',     '{"meta_line":"CERAMIC · SIZE 02 · 1–2 CUPS"}'),
  ('paper-filters-02',              '{"meta_line":"100 PCS · SIZE 02 · OXYGEN-BLEACHED"}'),
  ('ember-oak-ceramic-mug',         '{"meta_line":"300 ML · STONEWARE · CREAM + TERRACOTTA"}'),
  ('glass-carafe-brewer',           '{"meta_line":"600 ML · BOROSILICATE · WOOD COLLAR"}')
) as v(slug, meta)
where products.slug = v.slug;

-- order numbers: EO-2026-0841 style
alter sequence public.order_number_seq restart with 840;
alter table public.orders
  alter column order_number
  set default 'EO-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.order_number_seq')::text, 4, '0');

-- ------------------------------------------------------------
-- Sample orders (8, matching the admin design mock)
-- ------------------------------------------------------------
do $$
declare
  seed record;
  o_id uuid;
  sub int;
  ship int;
begin
  for seed in
    select * from (values
      ('Felix Maier',   'felix.m@mail.de',      'Hauptstraße 12',    '79098', 'Freiburg',  'Germany', 'canceled', '2026-08-11T09:14:00+02'::timestamptz, array['ember-blend-dark-roast:1','honey-almond-granola:1','dark-cacao-bar-70:1']),
      ('Sofia Lang',    'sofia.lang@web.de',    'Gartenweg 3',       '79102', 'Freiburg',  'Germany', 'marked',   '2026-08-11T15:40:00+02'::timestamptz, array['ember-blend-dark-roast:1']),
      ('David Braun',   'd.braun@posteo.de',    'Mühlenstraße 8',    '70173', 'Stuttgart', 'Germany', 'open',     '2026-08-12T08:05:00+02'::timestamptz, array['sunrise-single-origin-ethiopia:2','wildflower-honey:1']),
      ('Anna Schulz',   'anna.schulz@mail.de',  'Lindenallee 21',    '76133', 'Karlsruhe', 'Germany', 'canceled', '2026-08-12T17:22:00+02'::timestamptz, array['honey-almond-granola:2','dark-cacao-bar-70:1']),
      ('Tom Richter',   'tom.richter@gmx.de',   'Bergstraße 44',     '79539', 'Lörrach',   'Germany', 'marked',   '2026-08-13T10:31:00+02'::timestamptz, array['house-espresso-classic:2','paper-filters-02:2','oat-milk-syrup-vanilla:1']),
      ('Marie Keller',  'm.keller@web.de',      'Am Markt 2',        '79098', 'Freiburg',  'Germany', 'marked',   '2026-08-13T14:18:00+02'::timestamptz, array['ceramic-pour-over-dripper:1']),
      ('Jonas Weber',   'jonas.weber@mail.de',  'Rebbergweg 17',     '79576', 'Weil am Rhein', 'Germany', 'open', '2026-08-14T07:52:00+02'::timestamptz, array['ember-blend-dark-roast:1','sunrise-single-origin-ethiopia:1']),
      ('Lena Hoffmann', 'lena.hoffmann@example.com', 'Lindenstraße 24', '79098', 'Freiburg', 'Germany', 'open',   '2026-08-14T11:03:00+02'::timestamptz, array['ember-blend-dark-roast:1','sunrise-single-origin-ethiopia:2','honey-almond-granola:1'])
    ) as t(customer_name, email, street, zip, city, country, status, created_at, items)
  loop
    -- compute subtotal from live product prices
    select coalesce(sum(p.price_cents * split_part(i, ':', 2)::int), 0) into sub
    from unnest(seed.items) as i
    join public.products p on p.slug = split_part(i, ':', 1);

    ship := case when sub >= 4900 then 0 else 490 end;

    insert into public.orders
      (status, customer_name, email, street, zip, city, country,
       subtotal_cents, shipping_cents, total_cents, created_at, updated_at)
    values
      (seed.status::public.order_status, seed.customer_name, seed.email, seed.street,
       seed.zip, seed.city, seed.country, sub, ship, sub + ship, seed.created_at, seed.created_at)
    returning id into o_id;

    insert into public.order_items (order_id, product_id, product_name, unit_price_cents, quantity)
    select o_id, p.id, p.name, p.price_cents, split_part(i, ':', 2)::int
    from unnest(seed.items) as i
    join public.products p on p.slug = split_part(i, ':', 1);
  end loop;
end $$;
