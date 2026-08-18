/**
 * Idempotent Directus seeding for Ember & Oak.
 *
 * Run with:  yarn directus:seed
 * Requires:  yarn directus:setup to have been run first (collections + the
 *            "Ember & Oak" file folder must already exist).
 *
 * Three passes, in order:
 *   1. catalog — categories and products, upserted by slug
 *   2. images  — the product photos pulled from the (still live) Supabase
 *                storage bucket and uploaded into the "Ember & Oak" folder
 *   3. orders  — the eight demo orders, inserted directly. NEVER through the
 *                app's /api/orders route: that route sends confirmation mail
 *                and these are fake addresses.
 *
 * Safely re-runnable, because the repo is worked on from two PCs. Products
 * re-upsert; images and orders skip once they exist.
 *
 * Stock note: nothing here writes a stock counter. Availability is derived —
 * see the header of seed-data.ts.
 */
import { categories, products, demoOrders } from './seed-data.ts'
import { FREE_SHIPPING_CENTS, SHIPPING_FLAT_CENTS } from '../shared/utils/shop.ts'

const URL = (process.env.DIRECTUS_URL || '').replace(/\/$/, '')
const TOKEN = process.env.DIRECTUS_API_TOKEN
if (!URL || !TOKEN) throw new Error('DIRECTUS_URL / DIRECTUS_API_TOKEN missing in env')

/** The Supabase bucket is public, so no key is needed to read the images. */
const BUCKET = `${(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/public/product-images`

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${body?.errors?.[0]?.message ?? res.statusText}`)
  return body?.data
}

/** Create or update by slug. Returns the row id. */
async function upsertBySlug(collection: string, slug: string, payload: object): Promise<string> {
  const found = await api(`/items/${collection}?filter[slug][_eq]=${encodeURIComponent(slug)}&fields=id&limit=1`)
  if (found?.length) {
    await api(`/items/${collection}/${found[0].id}`, { method: 'PATCH', body: JSON.stringify(payload) })
    return found[0].id
  }
  const created = await api(`/items/${collection}`, { method: 'POST', body: JSON.stringify({ ...payload, slug }) })
  return created.id
}

async function seedCatalog() {
  console.log('Categories')
  const catIds: Record<string, string> = {}
  for (const c of categories) {
    catIds[c.slug] = await upsertBySlug('eo_categories', c.slug, c)
    console.log(`  ${c.slug}`)
  }

  console.log('Products')
  for (const p of products) {
    const { category_slug, image_file, ...rest } = p
    await upsertBySlug('eo_products', p.slug, { ...rest, category: catIds[category_slug] })
    console.log(`  ${p.slug}  stock_initial=${p.stock_initial}`)
  }
}

async function folderId(): Promise<string> {
  const found = await api(`/folders?filter[name][_eq]=${encodeURIComponent('Ember & Oak')}&fields=id&limit=1`)
  if (!found?.length) throw new Error('Folder "Ember & Oak" not found — run yarn directus:setup first')
  return found[0].id
}

/** Idempotent: skips a product that already has an image. */
async function seedImages() {
  console.log('Images')
  const folder = await folderId()

  for (const p of products) {
    const existing = await api(`/items/eo_products?filter[slug][_eq]=${p.slug}&fields=id,image&limit=1`)
    const row = existing?.[0]
    if (!row) throw new Error(`product ${p.slug} not seeded — run seedCatalog first`)
    if (row.image) { console.log(`  skip     ${p.slug}`); continue }

    const src = await fetch(`${BUCKET}/${p.image_file}`)
    if (!src.ok) throw new Error(`fetch ${p.image_file} → ${src.status}`)
    const blob = await src.blob()

    // `folder` MUST precede `file`: Directus reads multipart fields in order
    // and only applies non-file fields that arrived before the file itself.
    const form = new FormData()
    form.append('folder', folder)
    form.append('title', p.name)
    form.append('file', blob, p.image_file)

    const file = await api('/files', { method: 'POST', body: form })
    await api(`/items/eo_products/${row.id}`, { method: 'PATCH', body: JSON.stringify({ image: file.id }) })
    console.log(`  uploaded ${p.slug} → ${file.id}`)
  }
}

async function seedOrders() {
  console.log('Demo orders')
  const catalog: Array<{ id: string; slug: string; name: string; price_cents: number }> =
    await api('/items/eo_products?fields=id,slug,name,price_cents&limit=-1')
  const bySlug = new Map(catalog.map(p => [p.slug, p]))

  for (const o of demoOrders) {
    const existing = await api(`/items/eo_orders?filter[order_number][_eq]=${o.order_number}&fields=id&limit=1`)
    if (existing?.length) { console.log(`  skip   ${o.order_number}`); continue }

    const lines = o.items.map((spec) => {
      const [slug, qty] = spec.split(':')
      const p = bySlug.get(slug!)
      if (!p) throw new Error(`unknown product ${slug} in ${o.order_number}`)
      return { product: p.id, product_name: p.name, unit_price_cents: p.price_cents, quantity: Number(qty) }
    })

    // Priced from the live catalog, exactly as the old SQL block did.
    const subtotal = lines.reduce((n, l) => n + l.unit_price_cents * l.quantity, 0)
    const shipping = subtotal >= FREE_SHIPPING_CENTS ? 0 : SHIPPING_FLAT_CENTS

    const { order_number, customer_name, email, street, zip, city, country, status, date_created } = o
    const order = await api('/items/eo_orders', {
      method: 'POST',
      body: JSON.stringify({
        order_number, customer_name, email, street, zip, city, country, status, date_created,
        subtotal_cents: subtotal, shipping_cents: shipping, total_cents: subtotal + shipping,
      }),
    })

    await api('/items/eo_order_items', {
      method: 'POST',
      body: JSON.stringify(lines.map(l => ({ ...l, order: order.id }))),
    })

    // `date_created` carries special: ['date-created'], which Directus stamps
    // itself on insert — the value sent above is ignored. It only blocks the
    // field on create, so a PATCH right afterwards restores the demo date.
    let dateNote = 'date kept'
    if (order.date_created?.slice(0, 10) !== date_created.slice(0, 10)) {
      await api(`/items/eo_orders/${order.id}`, { method: 'PATCH', body: JSON.stringify({ date_created }) })
      dateNote = `date repaired (create stamped ${order.date_created})`
    }

    console.log(`  create ${o.order_number}  ${lines.length} lines  ${(subtotal + shipping) / 100}€  ${dateNote}`)
  }
}

async function main() {
  await seedCatalog()
  await seedImages()
  await seedOrders()
  console.log('\nDone.')
}

main().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1) })
