/**
 * Release the stock held by an order the buyer just backed out of.
 *
 * Stripe's "back" link only redirects to `cancel_url` — it does not cancel or
 * expire the session, so without this the order sits `pending`/`open` holding
 * its coffee until `sweepExpired()` reaches it 45 minutes later. That window is
 * long enough to lock a buyer out of their own cart: back out with 2 of a
 * 2-in-stock product, retry immediately, and the availability check counts the
 * abandoned order plus the new one and refuses them "only 0 left" on stock they
 * are holding themselves. Every retry stacks another ghost.
 *
 * Unauthenticated, like the confirmation route, and for the same reason: the
 * order id is an unguessable uuid acting as a capability token. What it can do
 * is deliberately tiny — cancel one unpaid order — and it asks Stripe first, so
 * the worst a stolen id achieves is expiring a checkout the holder abandoned
 * anyway. It returns 200 in almost every case: this is a courtesy call fired
 * and forgotten by the client, and there is nothing useful for it to report.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ orderId?: string }>(event)
  const id = body?.orderId

  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid order id' })
  }

  const order = await readFullOrder(id).catch(() => null)
  if (!order) return { released: false }

  // Only an untouched, unpaid checkout is ours to release. Anything else —
  // already paid, already canceled, already shipped — is not abandonment.
  if (order.payment_status !== 'pending' || order.status !== 'open') {
    return { released: false }
  }

  // Ask Stripe before cancelling. The client is untrusted and the buyer may
  // have paid in another tab between the redirect and this call; expiring a
  // paid order would release its stock and leave them charged with nothing.
  // markExpired() re-checks under the per-order lock, but this stops us even
  // trying. If Stripe is unreachable, do nothing and let the sweep decide.
  if (order.stripe_session_id) {
    try {
      const session = await stripe().checkout.sessions.retrieve(order.stripe_session_id)
      if (session.payment_status === 'paid') return { released: false }
    } catch (err) {
      console.error(`[abandon] could not verify session for order ${id}; leaving it to the sweep:`, err)
      return { released: false }
    }
  }

  await markExpired(id)
  return { released: true }
})
