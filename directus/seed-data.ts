/**
 * Seed data for the Ember & Oak Directus instance.
 *
 * Transcribed verbatim from the Supabase SQL files this migration replaces:
 *   - name / slug / tagline / description / price_cents  → supabase/schema.sql
 *   - meta                                               → supabase/migration-002-meta-and-orders.sql
 *   - demoOrders                                         → supabase/migration-002-meta-and-orders.sql
 *
 * The en dashes in names, the em dashes in descriptions and the `·`
 * separators in `meta_line` are load-bearing for the design — do not
 * "normalise" them.
 *
 * ⚠️ stock_initial is the GROSS number from the FIRST update in
 * supabase/migration-004-stock.sql — NOT the value sitting in
 * `products.stock` today. That live value is already net of the eight demo
 * orders below, because the old design decremented it with a database
 * trigger. The new model derives availability as
 *
 *     available = stock_initial − Σ quantity where order.status ≠ 'canceled'
 *
 * so seeding from the live value would subtract every demo order twice.
 */
import type { ProductMeta } from '../shared/types/directus.ts'

export const categories = [
  { name: 'Coffee', slug: 'coffee', sort_order: 1 },
  { name: 'Pantry', slug: 'pantry', sort_order: 2 },
  { name: 'Accessories', slug: 'accessories', sort_order: 3 },
]

export interface SeedProduct {
  category_slug: string
  name: string
  slug: string
  tagline: string
  description: string
  price_cents: number
  meta: ProductMeta
  stock_initial: number
  /** Filename in the Supabase product-images bucket. */
  image_file: string
}

export const products: SeedProduct[] = [
  {
    category_slug: 'coffee',
    name: 'Ember Blend – Dark Roast 250g',
    slug: 'ember-blend-dark-roast',
    tagline: 'Smoky, chocolatey, unapologetic.',
    description: 'Our signature dark roast. A blend of Brazilian and Sumatran beans roasted deep into the second crack — notes of dark chocolate, toasted hazelnut and a whisper of smoke. Built for espresso, brave enough for filter.',
    price_cents: 1490,
    meta: { weight_g: 250, meta_line: '250 G · WHOLE BEAN · BLEND · BRAZIL + SUMATRA', roast_pct: 88, flavors: ['Dark chocolate', 'Hazelnut', 'Smoke'] },
    stock_initial: 18,
    image_file: 'ember-blend-dark-roast.jpg',
  },
  {
    category_slug: 'coffee',
    name: 'Sunrise Single Origin – Ethiopia 250g',
    slug: 'sunrise-single-origin-ethiopia',
    tagline: 'Bright, floral, wide awake.',
    description: 'A washed heirloom lot from Yirgacheffe. Expect jasmine, bergamot and a juicy peach sweetness. Light roast, best enjoyed as a slow pour-over on a quiet morning.',
    price_cents: 1650,
    meta: { weight_g: 250, meta_line: '250 G · WHOLE BEAN · WASHED · YIRGACHEFFE', roast_pct: 26, flavors: ['Jasmine', 'Bergamot', 'Honeydew'] },
    stock_initial: 11,
    image_file: 'sunrise-single-origin-ethiopia.jpg',
  },
  {
    category_slug: 'coffee',
    name: 'House Espresso – Classic 500g',
    slug: 'house-espresso-classic',
    tagline: 'The daily workhorse.',
    description: 'Balanced and dependable: caramel sweetness, low acidity, a thick crema. The blend our own machines run on from open to close.',
    price_cents: 1990,
    meta: { weight_g: 500, meta_line: '500 G · WHOLE BEAN · BLEND · ESPRESSO', roast_pct: 72, flavors: ['Caramel', 'Cocoa', 'Thick crema'] },
    stock_initial: 25,
    image_file: 'house-espresso-classic.jpg',
  },
  {
    category_slug: 'coffee',
    name: 'Midnight Decaf – Swiss Water 250g',
    slug: 'midnight-decaf-swiss-water',
    tagline: 'All the ritual, none of the buzz.',
    description: 'A Colombian lot decaffeinated chemical-free with the Swiss Water process. Cocoa, red apple and brown sugar — proof that decaf deserves respect too.',
    price_cents: 1350,
    meta: { weight_g: 250, meta_line: '250 G · WHOLE BEAN · SWISS WATER · COLOMBIA', roast_pct: 55, flavors: ['Cocoa', 'Red apple', 'Brown sugar'] },
    stock_initial: 12,
    image_file: 'midnight-decaf-swiss-water.jpg',
  },
  {
    category_slug: 'pantry',
    name: 'Honey Almond Granola 500g',
    slug: 'honey-almond-granola',
    tagline: 'Breakfast, upgraded.',
    description: 'Slow-baked oats with roasted almonds, wildflower honey and a pinch of sea salt. Crunchy clusters that survive the milk.',
    price_cents: 850,
    meta: { weight_g: 500, meta_line: '500 G · SLOW-BAKED · OATS + ALMONDS' },
    stock_initial: 30,
    image_file: 'honey-almond-granola.jpg',
  },
  {
    category_slug: 'pantry',
    name: '70% Dark Cacao Bar',
    slug: 'dark-cacao-bar-70',
    tagline: 'Single-origin. Seriously dark.',
    description: 'Stone-ground Ecuadorian cacao, 70% and nothing to hide. Fruity depth with a clean snap — the natural companion to a dark roast.',
    price_cents: 690,
    meta: { weight_g: 100, meta_line: '100 G · STONE-GROUND · ECUADOR · 70%' },
    stock_initial: 0,
    image_file: 'dark-cacao-bar-70.jpg',
  },
  {
    category_slug: 'pantry',
    name: 'Oat Milk Syrup – Vanilla',
    slug: 'oat-milk-syrup-vanilla',
    tagline: "Your latte's best friend.",
    description: 'A silky vanilla syrup developed for oat milk drinks. Real Bourbon vanilla, no artificial aftertaste, dissolves instantly in hot or iced drinks.',
    price_cents: 750,
    meta: { meta_line: '250 ML · BOURBON VANILLA · FOR OAT DRINKS' },
    stock_initial: 9,
    image_file: 'oat-milk-syrup-vanilla.jpg',
  },
  {
    category_slug: 'pantry',
    name: 'Wildflower Honey 350g',
    slug: 'wildflower-honey',
    tagline: 'From hives we know by name.',
    description: "Raw, unfiltered wildflower honey from a small apiary in the foothills. Creamy texture, herbal finish — stir it into tea or eat it off the spoon, we won't judge.",
    price_cents: 990,
    meta: { weight_g: 350, meta_line: '350 G · RAW · UNFILTERED · SMALL APIARY' },
    stock_initial: 3,
    image_file: 'wildflower-honey.jpg',
  },
  {
    category_slug: 'accessories',
    name: 'Ceramic Pour-Over Dripper',
    slug: 'ceramic-pour-over-dripper',
    tagline: 'Slow coffee, done right.',
    description: 'A matte ceramic V-cone dripper with spiral ribs for an even extraction. Fits size 02 filters and sits happily on any mug or server.',
    price_cents: 2400,
    meta: { meta_line: 'CERAMIC · SIZE 02 · 1–2 CUPS' },
    stock_initial: 7,
    image_file: 'ceramic-pour-over-dripper.jpg',
  },
  {
    category_slug: 'accessories',
    name: 'Paper Filters Size 02 (100 pcs)',
    slug: 'paper-filters-02',
    tagline: 'The unsung heroes.',
    description: 'One hundred oxygen-bleached size 02 filters. Rinse, brew, compost, repeat.',
    price_cents: 450,
    meta: { meta_line: '100 PCS · SIZE 02 · OXYGEN-BLEACHED' },
    stock_initial: 40,
    image_file: 'paper-filters-02.jpg',
  },
  {
    category_slug: 'accessories',
    name: 'Ember & Oak Ceramic Mug',
    slug: 'ember-oak-ceramic-mug',
    tagline: 'Your new favourite mug.',
    description: 'A 300ml stoneware mug in warm cream with our terracotta stamp. Thick walls keep the heat in, the wide handle keeps your fingers out of trouble.',
    price_cents: 1800,
    meta: { meta_line: '300 ML · STONEWARE · CREAM + TERRACOTTA' },
    stock_initial: 15,
    image_file: 'ember-oak-ceramic-mug.jpg',
  },
  {
    category_slug: 'accessories',
    name: 'Glass Carafe Brewer 600ml',
    slug: 'glass-carafe-brewer',
    tagline: 'Brew it slow, serve it pretty.',
    description: 'A hand-blown borosilicate glass carafe with a natural wood collar and leather tie. Brews up to three cups of clean, sediment-free filter coffee — and looks good doing it.',
    price_cents: 3400,
    meta: { meta_line: '600 ML · BOROSILICATE · WOOD COLLAR' },
    stock_initial: 2,
    image_file: 'glass-carafe-brewer.jpg',
  },
]

export interface SeedOrder {
  order_number: string
  customer_name: string
  email: string
  street: string
  zip: string
  city: string
  country: string
  status: 'open' | 'marked' | 'canceled'
  date_created: string
  /** slug:qty */
  items: string[]
}

export const demoOrders: SeedOrder[] = [
  { order_number: 'EO-2026-0841', customer_name: 'Felix Maier', email: 'felix.m@mail.de', street: 'Hauptstraße 12', zip: '79098', city: 'Freiburg', country: 'Germany', status: 'canceled', date_created: '2026-08-11T09:14:00+02:00', items: ['ember-blend-dark-roast:1', 'honey-almond-granola:1', 'dark-cacao-bar-70:1'] },
  { order_number: 'EO-2026-0842', customer_name: 'Sofia Lang', email: 'sofia.lang@web.de', street: 'Gartenweg 3', zip: '79102', city: 'Freiburg', country: 'Germany', status: 'marked', date_created: '2026-08-11T15:40:00+02:00', items: ['ember-blend-dark-roast:1'] },
  { order_number: 'EO-2026-0843', customer_name: 'David Braun', email: 'd.braun@posteo.de', street: 'Mühlenstraße 8', zip: '70173', city: 'Stuttgart', country: 'Germany', status: 'open', date_created: '2026-08-12T08:05:00+02:00', items: ['sunrise-single-origin-ethiopia:2', 'wildflower-honey:1'] },
  { order_number: 'EO-2026-0844', customer_name: 'Anna Schulz', email: 'anna.schulz@mail.de', street: 'Lindenallee 21', zip: '76133', city: 'Karlsruhe', country: 'Germany', status: 'canceled', date_created: '2026-08-12T17:22:00+02:00', items: ['honey-almond-granola:2', 'dark-cacao-bar-70:1'] },
  { order_number: 'EO-2026-0845', customer_name: 'Tom Richter', email: 'tom.richter@gmx.de', street: 'Bergstraße 44', zip: '79539', city: 'Lörrach', country: 'Germany', status: 'marked', date_created: '2026-08-13T10:31:00+02:00', items: ['house-espresso-classic:2', 'paper-filters-02:2', 'oat-milk-syrup-vanilla:1'] },
  { order_number: 'EO-2026-0846', customer_name: 'Marie Keller', email: 'm.keller@web.de', street: 'Am Markt 2', zip: '79098', city: 'Freiburg', country: 'Germany', status: 'marked', date_created: '2026-08-13T14:18:00+02:00', items: ['ceramic-pour-over-dripper:1'] },
  { order_number: 'EO-2026-0847', customer_name: 'Jonas Weber', email: 'jonas.weber@mail.de', street: 'Rebbergweg 17', zip: '79576', city: 'Weil am Rhein', country: 'Germany', status: 'open', date_created: '2026-08-14T07:52:00+02:00', items: ['ember-blend-dark-roast:1', 'sunrise-single-origin-ethiopia:1'] },
  { order_number: 'EO-2026-0848', customer_name: 'Lena Hoffmann', email: 'lena.hoffmann@example.com', street: 'Lindenstraße 24', zip: '79098', city: 'Freiburg', country: 'Germany', status: 'open', date_created: '2026-08-14T11:03:00+02:00', items: ['ember-blend-dark-roast:1', 'sunrise-single-origin-ethiopia:2', 'honey-almond-granola:1'] },
]
