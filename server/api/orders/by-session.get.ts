/**
 * The confirmation page's source of truth.
 *
 * When Stripe redirects the buyer back, the webhook may not have arrived yet,
 * so this cannot simply trust our own database. If the order is still pending
 * it asks Stripe directly and applies the same transition the webhook would.
 * That is what keeps the purchase flow correct with webhooks entirely down.
 *
 * Unauthenticated by design: session_id is an unguessable capability token,
 * which is exactly how Stripe intends success URLs to work. The field
 * allow-list below is the mitigation — it exposes a delivery address, never
 * an account. Do not widen it to `...order`.
 */
export default defineEventHandler(async (event) => {
  const sessionId = getQuery(event).session_id
  if (typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid session id' })
  }

  let order = await orderBySessionId(sessionId)
  if (!order) throw createError({ statusCode: 404, statusMessage: 'Order not found' })

  if (order.payment_status === 'pending') {
    // Guarded, because this is a repair and not a precondition. We already hold
    // the order; if Stripe is slow, rate-limiting us, or the key has been
    // rotated to another account, the worst honest outcome is showing the buyer
    // their order as still pending and letting sweepExpired() reconcile it
    // within 45 minutes. Throwing instead would hand an error page to somebody
    // who has just been charged — the one person who most needs to see a page.
    //
    // It also stops Stripe's own status code leaking out as ours: a StripeError
    // carries `.statusCode`, and h3's createError copies it, so a Stripe 404
    // ("No such checkout.session") would surface as our 404 "Order not found"
    // for an order that plainly exists.
    try {
      const session = await stripe().checkout.sessions.retrieve(sessionId)
      if (session.payment_status === 'paid') {
        await markPaid(order.id, session)
        order = await readFullOrder(order.id)
      }
    } catch (err) {
      console.error(`[confirmation] could not verify session ${sessionId} with Stripe; showing the order as pending:`, err)
    }
  }

  return {
    order_number: order.order_number,
    payment_status: order.payment_status,
    // Fulfilment status is in the allow-list deliberately. markPaid() suppresses
    // the confirmation mail for an order that was cancelled before the payment
    // landed — without this field the page would undo that by rendering a
    // cheerful "thank you" for an order whose stock is already gone.
    // cancel_reason and cancel_note stay out: internal, and often blunt.
    status: order.status,
    customer_name: order.customer_name,
    email: order.email,
    street: order.street,
    zip: order.zip,
    city: order.city,
    country: order.country,
    subtotal_cents: order.subtotal_cents,
    shipping_cents: order.shipping_cents,
    total_cents: order.total_cents,
    items: order.items.map(i => ({
      product_name: i.product_name,
      unit_price_cents: i.unit_price_cents,
      quantity: i.quantity,
      product: i.product ? { id: i.product.id, slug: i.product.slug, image: i.product.image } : null,
    })),
  }
})
