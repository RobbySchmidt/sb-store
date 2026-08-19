import { aggregate, readItems } from '@directus/sdk'

/**
 * Availability, derived — never stored.
 *
 *   available(p) = stock_initial(p) − Σ (quantity − refunded_quantity)
 *                  over order lines whose order is not canceled
 *
 * This is why checkout is insert-only and cancellation needs no give-back:
 * a canceled order simply stops counting. There is no counter to decrement
 * and therefore no lost update to lose.
 *
 * `refunded_quantity` is the restock term: refunding two of three bags drops
 * that line's contribution from 3 to 1 and puts two straight back on sale.
 * A canceled order is excluded from the sum entirely, so an order that was
 * both refunded and canceled contributes zero either way — the two mechanisms
 * cannot both give the same bag back.
 *
 * Directus's aggregate API cannot express a computed subtraction, so both
 * fields are summed in one round-trip and subtracted per group here.
 *
 * Directus cannot create triggers or CHECK constraints, so unlike the old
 * Supabase design this is NOT a database guarantee — see withLock().
 */
export async function heldByOpenOrders(): Promise<Map<string, number>> {
  const rows = await directus().request(
    aggregate('eo_order_items', {
      aggregate: { sum: ['quantity', 'refunded_quantity'] },
      groupBy: ['product'],
      // `limit: -1` is load-bearing, not tidiness. Directus caps a query at 100
      // rows by default and that cap applies to GROUP rows too — so once more
      // than 100 products have open lines, a product falls off the end, gets no
      // entry here, reads back as `held = 0`, and the shop offers stock that is
      // already committed. Silent, unlogged, and in the direction that
      // oversells. availabilityFor() below has always passed it; this call did
      // not, which was a latent bug rather than a deliberate difference.
      query: { limit: -1, filter: { order: { status: { _neq: 'canceled' } } } },
    }),
  ) as unknown as Array<{
    product: string | null
    sum: { quantity: string | number | null, refunded_quantity: string | number | null }
  }>

  const held = new Map<string, number>()
  for (const r of rows) {
    if (!r.product) continue // line whose product was deleted

    const gross = Number(r.sum?.quantity ?? 0)
    const refunded = Number(r.sum?.refunded_quantity ?? 0)

    // NaN fails OPEN, so check before trusting the arithmetic. Number(null) and
    // Number('') are both 0, but Number(anything-else-non-numeric) is NaN — and
    // every downstream comparison is `have < want`, which is FALSE for NaN. One
    // NaN here would wave every checkout through regardless of stock, and `??`
    // does not catch it because NaN is neither null nor undefined.
    if (!Number.isFinite(gross)) {
      console.error(`[stock] non-numeric quantity sum for product ${r.product}: ${r.sum?.quantity}`)
      continue // no entry = treated as fully held by availabilityFor's caller
    }
    const net = Number.isFinite(refunded) ? gross - refunded : gross

    // A negative net means some line holds refunded_quantity > quantity —
    // corruption that refund() is supposed to make impossible on write.
    //
    // Fall back to `gross`, NOT to 0. Releasing to 0 would hand back the
    // product's ENTIRE held stock: ten bags committed to an open order, one bad
    // refund row, and the shop cheerfully offers all ten again. Ignoring the
    // refund term holds everything instead, which is the conservative answer.
    //
    // This only catches corruption large enough to flip the whole GROUP
    // negative. One bad line can still hide behind its siblings — q=1,rq=3
    // beside q=5,rq=0 sums to a healthy-looking 3 — and this check will not see
    // it. Treat it as a smoke alarm, not a guarantee; the real enforcement is
    // refund() capping each line before it writes.
    if (net < 0) {
      console.error(
        `[stock] refunded_quantity exceeds quantity for product ${r.product} ` +
        `(sum quantity=${r.sum?.quantity}, sum refunded=${r.sum?.refunded_quantity}). ` +
        `Holding the full quantity instead — this is a data bug, not a rounding artefact.`,
      )
    }
    held.set(r.product, net < 0 ? gross : net)
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
 * Serialises async work per key.
 *
 * CORRECT FOR A SINGLE NITRO PROCESS, AND ONLY FOR THAT. It is not a database
 * guarantee and must not be described as one. If this app is ever run across
 * multiple instances, get MySQL credentials and add a trigger-based guard.
 *
 * Two keys are in use:
 *   'stock'            — the global checkout critical section (see below)
 *   'payment:<id>'     — one order's payment transitions (server/utils/payments.ts)
 *
 * Keying matters: a refund is a network round-trip to Stripe, and putting that
 * behind the same mutex as every checkout would serialise the whole shop
 * behind Stripe's latency.
 *
 * NOT RE-ENTRANT, and it deadlocks permanently rather than erroring. Taking a
 * lock from inside the same lock — or 'stock' inside 'payment:x' in one path
 * while another does the reverse — hangs the tail forever, and because the tail
 * never settles every later caller on that key hangs too. There is no timeout
 * to break it: the shop wedges until the process restarts. Keep lock bodies
 * flat, and keep network calls (Stripe especially) outside them.
 */
const tails = new Map<string, Promise<unknown>>()

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // Chain onto this key's tail, and make the tail immune to this call's
  // rejection — otherwise one failure would poison every later call.
  const prev = tails.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.then(() => undefined, () => undefined)
  tails.set(key, tail)
  // Drop the entry once this is the last waiter, so the map does not grow one
  // entry per order id for the lifetime of the process.
  tail.then(() => { if (tails.get(key) === tail) tails.delete(key) })
  return run
}

/**
 * The checkout critical section.
 *
 * Deriving stock removes the lost update but not the check-then-insert window:
 * two checkouts can both compute "1 available" and both insert. This closes it.
 */
export function withStockLock<T>(fn: () => Promise<T>): Promise<T> {
  return withLock('stock', fn)
}
