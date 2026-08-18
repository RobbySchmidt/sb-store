import { aggregate, readItems } from '@directus/sdk'

/**
 * Availability, derived — never stored.
 *
 *   available(p) = stock_initial(p) − Σ quantity over order lines
 *                  whose order is not canceled
 *
 * This is why checkout is insert-only and cancellation needs no give-back:
 * a canceled order simply stops counting. There is no counter to decrement
 * and therefore no lost update to lose.
 *
 * Directus cannot create triggers or CHECK constraints, so unlike the old
 * Supabase design this is NOT a database guarantee — see withStockLock().
 */
export async function heldByOpenOrders(): Promise<Map<string, number>> {
  const rows = await directus().request(
    aggregate('eo_order_items', {
      aggregate: { sum: 'quantity' },
      groupBy: ['product'],
      query: { filter: { order: { status: { _neq: 'canceled' } } } },
    }),
  ) as unknown as Array<{ product: string | null, sum: { quantity: string | number | null } }>

  const held = new Map<string, number>()
  for (const r of rows) {
    if (!r.product) continue // line whose product was deleted
    held.set(r.product, Number(r.sum?.quantity ?? 0))
  }
  return held
}

/** stock_available for one set of product ids. */
export async function availabilityFor(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map()
  const [held, rows] = await Promise.all([
    heldByOpenOrders(),
    directus().request(readItems('eo_products', {
      fields: ['id', 'stock_initial'],
      filter: { id: { _in: ids } },
      limit: -1,
    })),
  ])
  return new Map(rows.map(p => [p.id, p.stock_initial - (held.get(p.id) ?? 0)]))
}

/**
 * Serialises the read-check-insert sequence.
 *
 * Deriving stock removes the lost update but not the check-then-insert window:
 * two checkouts can both compute "1 available" and both insert. This closes it.
 *
 * CORRECT FOR A SINGLE NITRO PROCESS, AND ONLY FOR THAT. It is not a database
 * guarantee and must not be described as one. If this app is ever run across
 * multiple instances, get MySQL credentials and add a trigger-based guard.
 */
let tail: Promise<unknown> = Promise.resolve()

export function withStockLock<T>(fn: () => Promise<T>): Promise<T> {
  // Chain onto the tail, and make the tail immune to this call's rejection —
  // otherwise one failed checkout would poison every later one.
  const run = tail.then(fn, fn)
  tail = run.then(() => undefined, () => undefined)
  return run
}
