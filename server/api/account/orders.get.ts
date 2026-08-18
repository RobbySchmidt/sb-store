import { readItems } from '@directus/sdk'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = directus()
  // product(...) is a live relation for thumbnails and links only — name and
  // price stay snapshotted on the line. Null once the product is deleted.
  const fields = ['*', { items: ['*', { product: ['id', 'slug', 'image'] }] }] as const

  // `fields as any`: the SDK cannot see through EoOrderItem.product's `| null`
  // to the relation, so it rejects the nested expansion at the type level only.
  //
  // Two queries rather than one _or filter, matching the original reasoning:
  // keep the email match a plain equality rather than something assembled by
  // string concatenation.
  const [byUser, byEmail] = await Promise.all([
    db.request(readItems('eo_orders', { fields: fields as any, filter: { user: { _eq: user.id } }, limit: -1 })),
    user.email
      ? db.request(readItems('eo_orders', { fields: fields as any, filter: { email: { _eq: user.email } }, limit: -1 }))
      : Promise.resolve([]),
  ])

  const merged = new Map<string, any>()
  for (const order of [...byUser, ...byEmail] as any[]) merged.set(order.id, order)

  return [...merged.values()].sort(
    (a, b) => new Date(b.date_created).getTime() - new Date(a.date_created).getTime(),
  )
})
