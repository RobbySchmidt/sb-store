import { readItems } from '@directus/sdk'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  // product(...) is a live relation for thumbnails and links only — name and
  // price stay snapshotted on the line. Null once the product is deleted.
  // `as any`: the SDK cannot see through EoOrderItem.product's `| null` to the
  // relation, so it rejects the nested expansion at the type level only.
  const fields = ['*', { items: ['*', { product: ['id', 'slug', 'image'] }] }] as const

  return await directus().request(readItems('eo_orders', {
    fields: fields as any,
    sort: ['-date_created'],
    limit: -1,
  }))
})
