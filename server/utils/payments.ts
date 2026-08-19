import { readItem, readItems, updateItem } from '@directus/sdk'
import type Stripe from 'stripe'
import type { EoOrder, EoOrderItem } from '../../shared/types/directus'
import { directus } from './directus'
import { stripe, siteUrl } from './stripe'
import { withLock } from './stock'
import { sendOrderConfirmation } from './email/confirmation'

/** Stripe's minimum session lifetime is 30 minutes. Short, because expiry IS the stock release. */
const SESSION_TTL_SECONDS = 30 * 60

/**
 * Margin added on top of the TTL so we clear Stripe's minimum instead of
 * landing exactly on it.
 *
 * Stripe requires `expires_at − created ≥ 1800`, where `created` is stamped on
 * THEIR clock when the request lands. Asking for exactly `now + 1800` fails
 * whenever the sub-second remainder plus network latency crosses a second
 * boundary: at .850s with 200ms latency the delta arrives as 1799 and Stripe
 * returns a 400 — after our order row already exists and is already holding
 * stock. Rounding up and adding a minute makes it unconditional.
 */
const SESSION_TTL_MARGIN_SECONDS = 60

/** Grace on top of the TTL before the sweep expires an order locally. Covers clock skew and webhook lag. */
const SWEEP_GRACE_SECONDS = 15 * 60

/** Most orders one sweep will expire. See the comment in sweepExpired(). */
const SWEEP_BATCH_SIZE = 25

/** The expansion every mail and every order page needs. */
const FULL_FIELDS = ['*', { items: ['*', { product: ['id', 'slug', 'image'] }] }] as any

export async function readFullOrder(id: string): Promise<any> {
  return await directus().request(readItem('eo_orders', id, { fields: FULL_FIELDS }))
}

/** The one order carrying this Checkout Session, or null. */
export async function orderBySessionId(sessionId: string): Promise<any | null> {
  const rows = await directus().request(readItems('eo_orders', {
    fields: FULL_FIELDS,
    filter: { stripe_session_id: { _eq: sessionId } },
    limit: 1,
  }))
  return rows[0] ?? null
}

/**
 * Exactly what building a Checkout Session needs — no more.
 *
 * Stated structurally rather than as `any` because the mistake this catches is
 * a real one: passing an order read WITHOUT `items` expanded. Directus would
 * hand back an array of id strings, `unit_price_cents` would be undefined, and
 * Stripe would reject the line items at runtime. Typed, it fails at edit time.
 */
type SessionOrder = Pick<EoOrder, 'id' | 'order_number' | 'email' | 'shipping_cents'> & {
  items: Array<Pick<EoOrderItem, 'product_name' | 'unit_price_cents' | 'quantity'>>
}

/**
 * Create the hosted Checkout Session for an order that is already stored.
 *
 * Called OUTSIDE the stock lock on purpose: this is a network round-trip to
 * Stripe, and holding the global checkout mutex across it would put Stripe's
 * latency in front of every other buyer's availability check.
 */
export async function createCheckoutSession(order: SessionOrder): Promise<Stripe.Checkout.Session> {
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = order.items.map(l => ({
    quantity: l.quantity,
    price_data: {
      currency: 'eur',
      unit_amount: l.unit_price_cents,
      product_data: { name: l.product_name },
    },
  }))

  // Shipping as its own line so the Stripe total matches total_cents exactly.
  if (order.shipping_cents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: order.shipping_cents,
        product_data: { name: 'Shipping' },
      },
    })
  }

  return await stripe().checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    customer_email: order.email,
    // Math.ceil, not floor — see SESSION_TTL_MARGIN_SECONDS.
    expires_at: Math.ceil(Date.now() / 1000) + SESSION_TTL_SECONDS + SESSION_TTL_MARGIN_SECONDS,
    metadata: { order_id: order.id, order_number: order.order_number },
    success_url: `${siteUrl()}/confirmation?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl()}/checkout?canceled=1`,
  })
}

/**
 * pending → paid. Idempotent, and it has to be: the webhook and the
 * confirmation page both call it, Stripe retries on any non-2xx, and Stripe
 * does not guarantee delivery order.
 */
export async function markPaid(orderId: string, session: Stripe.Checkout.Session): Promise<void> {
  await withLock(`payment:${orderId}`, async () => {
    const db = directus()
    // Re-read inside the lock — the other caller may have won the race.
    const current = await db.request(readItem('eo_orders', orderId, { fields: ['payment_status'] }))
    if (current.payment_status !== 'pending') return

    const intent = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null

    await db.request(updateItem('eo_orders', orderId, {
      payment_status: 'paid',
      paid_at: new Date().toISOString(),
      stripe_payment_intent: intent,
    }))

    if (intent === null) {
      // mode:'payment' card sessions always carry one, so this should not
      // happen — but the `pending` guard above means a null written here can
      // never be corrected, and refund() needs the intent. Silent would mean
      // discovering it only when a refund fails months later.
      console.warn(`[stripe] session ${session.id} completed with no payment_intent — order ${orderId} will not be refundable`)
    }

    // The confirmation mail moved here from /api/orders — an order that is
    // never paid must never be confirmed.
    //
    // The READ is inside the catch too, not just the send. It is part of the
    // mail path, and a transient Directus blip here would otherwise throw past
    // the already-committed `paid` write: the webhook returns non-2xx, Stripe
    // retries, and the retry hits the `pending` guard and returns early — so
    // the guard that makes this idempotent becomes the thing that guarantees
    // the buyer is charged and never emailed.
    await (async () => {
      const full = await readFullOrder(orderId)
      await sendOrderConfirmation(full)
    })().catch(err =>
      console.error(`[mail] confirmation for order ${orderId} failed:`, err),
    )
  })
}

/**
 * pending → expired. Cancels the order, which is what releases the stock —
 * the derived formula does the give-back with no counter to touch.
 * Deliberately silent: an abandoned cart must not generate mail.
 */
export async function markExpired(orderId: string): Promise<void> {
  await withLock(`payment:${orderId}`, async () => {
    const db = directus()
    const current = await db.request(readItem('eo_orders', orderId, {
      fields: ['payment_status', 'status'],
    }))
    if (current.payment_status !== 'pending') return

    // `status` must be checked too, not just payment_status. An admin can
    // cancel a still-pending order from the dashboard, and that write does not
    // touch payment_status — so without this the sweep comes along 45 minutes
    // later, sees `pending`, and overwrites their cancel_reason with
    // 'payment_expired' while destroying their cancel_note outright. No log, no
    // trace, and the dashboard then claims checkout expired on an order somebody
    // cancelled deliberately. The same guard stops a shipped order being
    // dragged back to canceled.
    if (current.status !== 'open') return

    await db.request(updateItem('eo_orders', orderId, {
      payment_status: 'expired',
      status: 'canceled',
      cancel_reason: 'payment_expired',
      cancel_note: null,
    }))
  })
}

/**
 * Expire every pending order past its window, without asking Stripe.
 *
 * A webhook is not a guarantee: a stranded order with no session id will never
 * be mentioned by one, and a misconfigured endpoint means no abandoned order
 * ever expires. Either way the order keeps holding stock forever. This is what
 * actually makes expiry correct; the webhook only makes it fast.
 *
 * Safe without consulting Stripe. Past expires_at the session is dead on
 * Stripe's side too, so nobody can pay one out from under the sweep, and the
 * grace period covers clock skew. Orders with no session id were never payable.
 */
export async function sweepExpired(): Promise<number> {
  const cutoff = new Date(Date.now() - (SESSION_TTL_SECONDS + SWEEP_GRACE_SECONDS) * 1000).toISOString()
  const stale = await directus().request(readItems('eo_orders', {
    fields: ['id'],
    filter: {
      payment_status: { _eq: 'pending' },
      // Already-canceled orders are excluded here as well as in markExpired.
      // Cheaper to not fetch them, and it keeps the batch budget below for
      // orders that actually need work.
      status: { _eq: 'open' },
      // Cast only the operand that objects: `date_created` is a plain `string`
      // in our hand-written Schema, so the SDK offers string operators and
      // makes `_lt` `never`. Directus handles `_lt` on a datetime fine. Casting
      // the whole filter object would also un-check `payment_status` beside it,
      // where a typo ('pendign') would compile and sweep nothing forever —
      // failing in the invisible direction, with stock held and no symptom.
      date_created: { _lt: cutoff } as any,
    },
    // Bounded on purpose. This runs inside a buyer's checkout request, and
    // markExpired costs two serial Directus round-trips each. An unbounded
    // backlog — a weekend with a misconfigured webhook — would make the next
    // buyer wait out every single expiry before their own order is even priced.
    // The sweep is idempotent and runs on every order and every admin list, so
    // a backlog drains across successive requests instead of landing on one
    // unlucky customer.
    limit: SWEEP_BATCH_SIZE,
    sort: ['date_created'],
  }))
  for (const o of stale) await markExpired(o.id)
  if (stale.length) {
    console.log(
      `[sweep] expired ${stale.length} abandoned order(s)` +
      (stale.length === SWEEP_BATCH_SIZE ? ' — batch full, more may remain' : ''),
    )
  }
  return stale.length
}
