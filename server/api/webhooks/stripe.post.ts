/**
 * Stripe webhook receiver. Public and unauthenticated — the signature IS the
 * authentication, so verification is not optional.
 *
 * Local development: stripe listen --forward-to localhost:3000/api/webhooks/stripe
 */
import type Stripe from 'stripe'

/** Generous next to Stripe's few-KB payloads; small enough not to be a lever. */
const MAX_BODY_BYTES = 1_000_000

export default defineEventHandler(async (event) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    // Detail to the log, not to the caller: this is the one route where the
    // requester is by definition untrusted, and Nitro returns `message`
    // verbatim in production. No need to tell the internet which env var we
    // are missing.
    console.error('[stripe] STRIPE_WEBHOOK_SECRET missing — cannot verify webhooks')
    throw createError({ statusCode: 500, statusMessage: 'Webhook not configured' })
  }

  const signature = getHeader(event, 'stripe-signature')
  if (!signature) throw createError({ statusCode: 400, statusMessage: 'Missing stripe-signature' })

  // Cheap length check before buffering. Authentication cannot happen until the
  // whole body is read, so without this an anonymous caller can make us hold an
  // arbitrarily large payload in memory before a single byte is verified.
  const declared = Number(getHeader(event, 'content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Payload too large' })
  }

  // MUST be the raw bytes. readBody() would parse and re-stringify the JSON,
  // changing it just enough to invalidate the signature. This is the standard
  // first bug in every Stripe integration.
  const raw = await readRawBody(event, false)
  if (!raw) throw createError({ statusCode: 400, statusMessage: 'Empty body' })

  // Typed, not `as any`. Stripe.Event is a proper discriminated union, and the
  // cast that used to be here disabled the only check that would catch a
  // payload with no session id — which orderBySessionId() would then answer
  // with an arbitrary order.
  let stripeEvent: Stripe.Event
  try {
    stripeEvent = stripe().webhooks.constructEvent(raw, signature, secret)
  } catch (e: any) {
    console.error('[stripe] signature verification failed:', e.message)
    throw createError({ statusCode: 400, statusMessage: 'Invalid signature' })
  }

  if (stripeEvent.type === 'checkout.session.completed' || stripeEvent.type === 'checkout.session.expired') {
    const session = stripeEvent.data.object

    // Belt to the type annotation's braces. orderBySessionId() now refuses a
    // non-string, but catching it here keeps the reason visible in the log.
    if (typeof session.id !== 'string') {
      console.error(`[stripe] ${stripeEvent.type} carried no session id — ignoring`)
      return { received: true }
    }

    const order = await orderBySessionId(session.id)

    // 200 on an unknown session, NOT 404: a 404 makes Stripe retry an event we
    // will never be able to handle, forever.
    if (!order) {
      console.warn(`[stripe] ${stripeEvent.type} for unknown session ${session.id}`)
      return { received: true }
    }

    if (stripeEvent.type === 'checkout.session.completed') {
      // `completed` means the SESSION finished, not that money arrived. For
      // delayed-notification methods it is delivered with payment_status
      // 'unpaid' and the outcome lands later on async_payment_succeeded /
      // async_payment_failed — events we deliberately do not handle.
      //
      // Nothing in this repo picks the payment methods: createCheckoutSession
      // passes no `payment_method_types`, so the set is whatever the Stripe
      // dashboard has enabled. Someone turning on SEPA Direct Debit — one
      // click, no code change — would otherwise mark orders paid on a promise,
      // ship the coffee, and silently drop the failure three days later.
      //
      // sweepExpired() already makes exactly this check before recovering an
      // order. This is the one place that did not.
      if (session.payment_status !== 'paid') {
        console.warn(`[stripe] session ${session.id} completed with payment_status=${session.payment_status} — not marking paid`)
        return { received: true }
      }
      await markPaid(order.id, session)
    } else {
      await markExpired(order.id)
    }
  }

  // Everything else is acknowledged and ignored. Stripe sends more event types
  // than you subscribe to, and a non-2xx makes it retry them indefinitely.
  return { received: true }
})
