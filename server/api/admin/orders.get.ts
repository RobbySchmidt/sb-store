import { readItems } from '@directus/sdk'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  // Same reconciliation pass as checkout — the dashboard must never show a
  // phantom hold. It asks Stripe about each stale order first, so it can just
  // as well mark one paid; a run with nothing to do costs one Directus read,
  // and it is bounded to SWEEP_BATCH_SIZE because each order is a round-trip.
  // Never fatal: the list is still worth serving if Stripe or Directus blinks.
  await sweepExpired().catch(err => console.error('[sweep] failed:', err))

  // Abandoned checkouts are hidden by default: every one produces a canceled
  // order, and on a busy shop they would bury the real ones. The data stays,
  // behind ?includeExpired=1.
  const includeExpired = getQuery(event).includeExpired === '1'

  // product(...) is a live relation for thumbnails and links only — name and
  // price stay snapshotted on the line. Null once the product is deleted.
  // `as any`: the SDK cannot see through EoOrderItem.product's `| null` to the
  // relation, so it rejects the nested expansion at the type level only.
  const fields = ['*', { items: ['*', { product: ['id', 'slug', 'image'] }] }] as const

  return await directus().request(readItems('eo_orders', {
    fields: fields as any,
    ...(includeExpired ? {} : { filter: { payment_status: { _neq: 'expired' } } }),
    sort: ['-date_created'],
    limit: -1,
  }))
})
