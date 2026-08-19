import { readItem, readItems, updateItem } from '@directus/sdk'
// Auto-imported in server ROUTES, but not in server/utils — this file is a
// plain module, so it needs the explicit import like every other one here.
import { createError } from 'h3'
import type Stripe from 'stripe'
import type { EoOrder, EoOrderItem, EoProduct } from '../../shared/types/directus'
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

/**
 * Most orders one sweep will handle.
 *
 * Deliberately small: each one now costs a Stripe round-trip plus up to two
 * Directus writes, and this runs inside a buyer's checkout request. A backlog
 * drains across successive calls rather than landing on one unlucky customer.
 */
const SWEEP_BATCH_SIZE = 10

/** The expansion every mail and every order page needs. */
const FULL_FIELDS = ['*', { items: ['*', { product: ['id', 'slug', 'image'] }] }] as any

/**
 * An order shaped the way FULL_FIELDS reads it: items expanded, and each item's
 * `product` expanded to just what a thumbnail and a link need (or null once the
 * product is deleted — the line keeps its snapshotted name and price).
 *
 * Declared rather than left as `any` because the routes that consume it build
 * hand-written field allow-lists, and `any` means nothing checks the keys. A
 * field renamed in Directus would otherwise produce `undefined`, get dropped
 * silently by JSON.stringify, and show up as a blank line on the confirmation
 * page with no error anywhere. CLAUDE.md calls a missed field rename the thing
 * this project is least able to catch; this is what makes the compiler catch it.
 */
export type FullOrder = Omit<EoOrder, 'items'> & {
  items: Array<Omit<EoOrderItem, 'product'> & {
    product: Pick<EoProduct, 'id' | 'slug' | 'image'> | null
  }>
}

export async function readFullOrder(id: string): Promise<FullOrder> {
  return await directus().request(readItem('eo_orders', id, { fields: FULL_FIELDS })) as unknown as FullOrder
}

/**
 * The one order carrying this Checkout Session, or null.
 *
 * The guard is not defensive padding — without it this function returns the
 * WRONG ORDER rather than nothing. `JSON.stringify` drops an undefined value,
 * so `{ _eq: undefined }` serialises to `{"stripe_session_id":{}}`, the
 * operator disappears, and Directus reads that as no constraint at all: the
 * query comes back with the first order in the collection. Verified against the
 * live instance. Every caller then sails past its `if (!order)` check and acts
 * on a stranger's order — cancelling it, releasing its stock, or emailing its
 * customer a confirmation for a payment that never happened.
 */
export async function orderBySessionId(sessionId: string): Promise<FullOrder | null> {
  if (typeof sessionId !== 'string' || !sessionId) return null

  const rows = await directus().request(readItems('eo_orders', {
    fields: FULL_FIELDS,
    filter: { stripe_session_id: { _eq: sessionId } },
    limit: 1,
  })) as unknown as FullOrder[]
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
    // The order id rides along so the checkout page can release its stock the
    // moment the buyer backs out, rather than leaving it held until the sweep.
    // Our own id rather than {CHECKOUT_SESSION_ID}: Stripe documents that
    // template variable for success_url, and the session id does not exist yet
    // at the point this URL is built anyway.
    cancel_url: `${siteUrl()}/checkout?canceled=1&abandoned=${order.id}`,
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
    const current = await db.request(readItem('eo_orders', orderId, {
      fields: ['payment_status', 'status', 'order_number'],
    }))
    if (current.payment_status !== 'pending') return

    // Money can arrive for an order somebody already cancelled: an admin
    // cancels a pending order at minute 10 while the buyer is still sitting on
    // Stripe's page, and they pay at minute 12. The payment is real and must be
    // recorded — without stripe_payment_intent the order is unrefundable — but
    // the customer must NOT be told their order is confirmed when its stock has
    // already been released to other buyers.
    const wasCancelled = current.status === 'canceled'

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

    if (wasCancelled) {
      console.error(
        `[payments] order ${current.order_number} was PAID AFTER BEING CANCELLED. ` +
        `Payment recorded (intent ${intent}) but no confirmation sent — its stock is already ` +
        `released. REFUND THIS MANUALLY.`,
      )
      return
    }

    // The confirmation mail moved here from /api/orders — an order that is
    // never paid must never be confirmed.
    //
    // Deliberately NOT awaited. This runs on the webhook's request path, and
    // awaiting an SMTP round-trip to mail.agenturserver.de would put it inside
    // Stripe's 30-second timeout budget. The house rule is fire-and-forget
    // (CLAUDE.md); this module has no `event` for `waitUntil`, so `void` plus a
    // `.catch` is the equivalent. A mail failure must never fail the request.
    //
    // The READ is inside the catch too, not just the send. It is part of the
    // mail path, and a transient Directus blip there would otherwise throw past
    // the already-committed `paid` write: the webhook returns non-2xx, Stripe
    // retries, and the retry hits the `pending` guard and returns early — so
    // the guard that makes this idempotent would become the thing that
    // guarantees the buyer is charged and never emailed.
    void (async () => {
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
 * Reconcile every pending order past its window against Stripe.
 *
 * A webhook is not a guarantee: a stranded order with no session id will never
 * be mentioned by one, and a misconfigured endpoint means no abandoned order
 * ever expires. Either way the order keeps holding stock forever. This is what
 * actually makes expiry correct; the webhook only makes it fast.
 *
 * IT ASKS STRIPE BEFORE CANCELLING ANYTHING, and that is not optional.
 * An earlier version expired on the local clock alone, which was wrong in the
 * one way that costs a real person real money: pay at minute 29, close the tab,
 * and if the webhook never lands — a misconfigured endpoint, a dead tunnel —
 * the sweep reaches a genuinely paid order at minute 45 and cancels it. No
 * refund, no mail, stock released, money gone. It is the only path in this
 * system where somebody is charged and left with nothing.
 *
 * Consulting Stripe also turns the sweep into a repair: a paid session whose
 * webhook was lost gets marked paid here, confirmation mail and all. That is
 * what lets the design claim the webhook is a latency optimisation rather than
 * a correctness requirement — without this, that claim is false.
 */
export async function sweepExpired(): Promise<number> {
  const cutoff = new Date(Date.now() - (SESSION_TTL_SECONDS + SWEEP_GRACE_SECONDS) * 1000).toISOString()
  const stale = await directus().request(readItems('eo_orders', {
    fields: ['id', 'stripe_session_id'],
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
  let expired = 0
  let recovered = 0

  for (const o of stale) {
    // No session id means session creation failed before it was ever recorded,
    // so this order was never payable by anyone. Nothing to ask Stripe about.
    if (!o.stripe_session_id) {
      await markExpired(o.id)
      expired++
      continue
    }

    let session
    try {
      session = await stripe().checkout.sessions.retrieve(o.stripe_session_id)
    } catch (err) {
      // Stripe unreachable, or the session is unknown to it. Do NOT cancel on a
      // guess — leave the order alone and let the next sweep decide. Holding
      // stock a while longer is cheap; cancelling a paid order is not.
      console.error(`[sweep] could not verify session for order ${o.id}, leaving it alone:`, err)
      continue
    }

    if (session.payment_status === 'paid') {
      // The webhook was lost. Repair it rather than cancelling: this marks the
      // order paid and sends the confirmation the buyer never got.
      console.warn(`[sweep] order ${o.id} was paid but never marked — recovering it (webhook likely not delivered)`)
      await markPaid(o.id, session)
      recovered++
      continue
    }

    await markExpired(o.id)
    expired++
  }

  if (expired || recovered) {
    console.log(
      `[sweep] expired ${expired}, recovered ${recovered}` +
      (stale.length === SWEEP_BATCH_SIZE ? ' — batch full, more may remain' : ''),
    )
  }
  return expired
}

export interface RefundLine {
  /** eo_order_items id */
  itemId: string
  /** How many to refund NOW — not the running total. */
  quantity: number
}

export interface RefundResult {
  amountCents: number
  refundedCents: number
  lines: Array<{ product_name: string, quantity: number, amount_cents: number }>
}

/** One order line as FULL_FIELDS reads it. Not `any`: the per-line cap is
 *  arithmetic on `quantity`, `refunded_quantity` and `unit_price_cents`, and a
 *  field renamed in Directus would otherwise silently make it `NaN`. */
type FullOrderItem = FullOrder['items'][number]

/**
 * Refund some or all of an order.
 *
 * Everything runs inside the per-order lock and the order is re-read INSIDE it,
 * so two concurrent refunds cannot both validate against stale numbers.
 *
 * `extraCents` is how cancel returns the shipping: a line refund never touches
 * it, because apportioning shipping across lines is arithmetic nobody asked for.
 *
 * Throws on any guard failure — the caller turns that into a 409/400 and
 * nothing is written, which is the whole point of refunding before the status
 * write in the PATCH handler.
 *
 * NOT re-entrant: it takes `payment:<orderId>`, the same key markPaid and
 * markExpired take, so never call either from inside it.
 *
 * `lines` may deliberately be EMPTY when `extraCents` is set. That is how the
 * cancel path returns shipping on an order whose lines were already refunded
 * individually. The non-empty check lives in the refund ROUTE, not here — do
 * not "harden" this function by moving it down, or shipping-only cancels start
 * failing with "Nothing to refund" and the money stays with us.
 */
export async function refund(
  orderId: string,
  lines: RefundLine[],
  requestId: string,
  extraCents = 0,
): Promise<RefundResult> {
  // Validated here as well as in the route: this function is the enforcement
  // point, and an empty key would collapse every refund on the order onto one
  // Stripe idempotency record for 24h. Stripe would then return the CACHED
  // first refund with no error, and we would write refunded_quantity and
  // refunded_cents for money that never moved.
  if (typeof requestId !== 'string' || requestId.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Missing or invalid refund requestId' })
  }

  // A negative adjustment is the one silently money-losing input this function
  // could accept: `amount` would come out below the lines' worth, so we would
  // refund less than we then record as refunded — writing refunded_quantity for
  // the full quantities and under-paying the customer, with the books claiming
  // otherwise. Unreachable from either caller today; refused so it stays that
  // way by construction rather than by argument.
  if (!Number.isFinite(extraCents) || extraCents < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid refund adjustment' })
  }

  return await withLock(`payment:${orderId}`, async () => {
    const db = directus()
    const order = await readFullOrder(orderId).catch(() => null)
    if (!order) throw createError({ statusCode: 404, statusMessage: 'Order not found' })

    if (order.payment_status !== 'paid') {
      throw createError({ statusCode: 409, statusMessage: 'This order has not been paid, so there is nothing to refund.' })
    }
    if (!order.stripe_payment_intent) {
      throw createError({ statusCode: 409, statusMessage: 'This order has no payment on file.' })
    }

    // Validate every line against its remaining refundable quantity BEFORE
    // calling Stripe. Get the per-line caps right and the order total cannot
    // be exceeded.
    const planned: Array<{ item: FullOrderItem, quantity: number, amount: number, nextRefundedQuantity: number }> = []
    const seen = new Set<string>()
    for (const l of lines) {
      const item = order.items.find(i => i.id === l.itemId)
      if (!item) throw createError({ statusCode: 400, statusMessage: 'Unknown order line' })
      // Two entries for the same line would each be capped against the SAME
      // stale refunded_quantity, so 2 + 2 would pass on a line of 3 — and the
      // second write would then overwrite the first with 0 + 2 rather than
      // accumulate. Stripe would refund four units of money while the row
      // recorded two, under-restoring stock. A caller wanting 4 of one line
      // sends one entry with quantity 4.
      if (seen.has(l.itemId)) {
        throw createError({ statusCode: 400, statusMessage: 'Each order line may appear only once in a refund' })
      }
      seen.add(l.itemId)
      if (!Number.isInteger(l.quantity) || l.quantity < 1) {
        throw createError({ statusCode: 400, statusMessage: 'Refund quantity must be a positive whole number' })
      }
      // Coerce the stored values explicitly, and refuse to proceed unless all
      // three are finite. `FullOrder` is an assertion over an `as any` field
      // list — nothing validates that Directus actually returned numbers — and
      // JS's coercion is asymmetric here in the worst possible way:
      //
      //   item.quantity - "2"                     → 1   (subtraction coerces)
      //   (item.refunded_quantity ?? 0) + 1       → "21" (addition CONCATENATES)
      //
      // so a string-typed column would pass the cap and then write 21 refunded
      // on a 3-bag line. A missing field is worse: `remaining` becomes NaN,
      // `l.quantity > NaN` is false, and the cap FAILS OPEN. heldByOpenOrders()
      // guards this exact class downstream; this is the upstream enforcement,
      // so it cannot be the one place that trusts the data.
      const qty = Number(item.quantity)
      const alreadyRefunded = Number(item.refunded_quantity ?? 0)
      const unitPrice = Number(item.unit_price_cents)
      if (!Number.isFinite(qty) || !Number.isFinite(alreadyRefunded) || !Number.isFinite(unitPrice)) {
        console.error(`[refund] order line ${item.id} holds non-numeric values`, {
          quantity: item.quantity,
          refunded_quantity: item.refunded_quantity,
          unit_price_cents: item.unit_price_cents,
        })
        throw createError({ statusCode: 500, statusMessage: 'This order line is corrupt and cannot be refunded.' })
      }

      const remaining = qty - alreadyRefunded
      if (l.quantity > remaining) {
        throw createError({
          statusCode: 400,
          statusMessage: `Cannot refund ${l.quantity} × ${item.product_name} — only ${remaining} left to refund.`,
        })
      }
      planned.push({
        item,
        quantity: l.quantity,
        amount: unitPrice * l.quantity,
        nextRefundedQuantity: alreadyRefunded + l.quantity,
      })
    }

    // Amount is ALWAYS computed server-side. The client says which lines and
    // how many, never a euro figure — same rule as pricing a cart.
    const amount = planned.reduce((n, p) => n + p.amount, 0) + extraCents
    if (amount <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'Nothing to refund' })
    }
    if (order.refunded_cents + amount > order.total_cents) {
      throw createError({ statusCode: 400, statusMessage: 'That would refund more than the order total.' })
    }

    // requestId, not the order id: refunding €5 twice on a €20 order is
    // legitimate, so an order-scoped key would silently swallow the second,
    // correct refund. A retried submit reuses its id and Stripe collapses it.
    const created = await stripe().refunds.create(
      { payment_intent: order.stripe_payment_intent, amount },
      { idempotencyKey: `refund:${orderId}:${requestId}` },
    )

    // A refund can come back already dead. Writing refunded_quantity for one
    // would put coffee back on sale and email the customer about money that
    // never left. (A card refund can also fail asynchronously later, via
    // charge.refund.updated — we do not handle that; see the plan's known
    // limitations.)
    if (created.status === 'failed' || created.status === 'canceled') {
      throw createError({
        statusCode: 502,
        statusMessage: `Stripe rejected the refund (${created.status}). Nothing has been changed.`,
      })
    }

    // Everything past this point has ALREADY MOVED MONEY. A failure here leaves
    // the books behind the ledger, and the retry is the dangerous part: a fresh
    // requestId would pass every cap (the re-read still shows nothing refunded)
    // and take a second real refund out of the remaining headroom. So it fails
    // loudly, with everything reconciliation needs — the same register markPaid
    // uses for its unrecoverable case.
    try {
      for (const p of planned) {
        await db.request(updateItem('eo_order_items', p.item.id, {
          refunded_quantity: p.nextRefundedQuantity,
        }))
      }
      await db.request(updateItem('eo_orders', orderId, {
        refunded_cents: order.refunded_cents + amount,
        refunded_at: new Date().toISOString(),
      }))
    } catch (err) {
      console.error(
        `[refund] MONEY MOVED BUT THE ORDER WAS NOT UPDATED. Stripe refund ${created.id} ` +
        `of ${amount} cents against order ${order.order_number} (${orderId}) succeeded, then the ` +
        `write failed. RECONCILE BY HAND — retrying the refund will take the money twice. ` +
        `Lines: ${planned.map(p => `${p.item.id}→${p.nextRefundedQuantity}`).join(', ')}`,
        err,
      )
      throw err
    }

    return {
      amountCents: amount,
      refundedCents: order.refunded_cents + amount,
      lines: planned.map(p => ({
        product_name: p.item.product_name,
        quantity: p.quantity,
        amount_cents: p.amount,
      })),
    }
  })
}
