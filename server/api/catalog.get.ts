import { readItems } from '@directus/sdk'

/**
 * The public catalog, with derived availability.
 *
 * This route exists because stock_available is an aggregate over
 * eo_order_items, and order lines can never be public — so the browser can no
 * longer read the catalog directly the way Supabase RLS allowed.
 */
export default defineEventHandler(async () => {
  const db = directus()
  const [categories, products, held] = await Promise.all([
    db.request(readItems('eo_categories', { fields: ['*'], sort: ['sort_order'], limit: -1 })),
    db.request(readItems('eo_products', {
      fields: ['*', { category: ['id', 'name', 'slug'] }],
      filter: { is_active: { _eq: true } },
      sort: ['date_created'],
      limit: -1,
    })),
    heldByOpenOrders(),
  ])

  return {
    categories,
    products: products.map(p => ({
      ...p,
      stock_available: p.stock_initial - (held.get(p.id) ?? 0),
    })),
  }
})
