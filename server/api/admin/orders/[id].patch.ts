import { readItem, readItems, updateItem } from '@directus/sdk'
import { isCancelReasonKey } from '../../../../shared/utils/cancelReasons'
import { sendOrderCanceled } from '../../../utils/email/canceled'
import { sendOrderShipped } from '../../../utils/email/shipped'

const VALID_STATUSES = ['open', 'marked', 'canceled'] as const

const NOTE_MAX = 500

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const id = getRouterParam(event, 'id')
  const body = await readBody<{ status?: string; reason?: string | null; note?: string | null }>(event)

  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid order id' })
  }
  if (!body?.status || !VALID_STATUSES.includes(body.status as any)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid status' })
  }

  // ---- optional cancellation details ----
  const reason = body.reason ?? null
  if (reason !== null && !isCancelReasonKey(reason)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid cancel reason' })
  }

  let note: string | null = null
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string') {
      throw createError({ statusCode: 400, statusMessage: 'Invalid cancel note' })
    }
    const trimmed = body.note.trim()
    if (trimmed.length > NOTE_MAX) {
      throw createError({ statusCode: 400, statusMessage: 'Cancel note too long' })
    }
    note = trimmed || null
  }

  const db = directus()

  // Read the status we are coming from, so the mail only fires on a real transition
  const before = await db.request(readItem('eo_orders', id, {
    fields: ['status', 'payment_status', 'refunded_cents', 'total_cents', 'stripe_payment_intent'],
  })).catch(() => null)
  if (!before) throw createError({ statusCode: 404, statusMessage: 'Order not found' })

  // Never ship unpaid coffee. `pending` still holds stock and `expired` never
  // paid at all — neither may be marked as shipped.
  if (body.status === 'marked' && before.payment_status !== 'paid') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Cannot ship this order — it has not been paid.',
    })
  }

  // The reason columns belong to a cancellation and are cleared by any other status
  const patch = body.status === 'canceled'
    ? { status: body.status, cancel_reason: reason, cancel_note: note }
    : { status: body.status, cancel_reason: null, cancel_note: null }

  // Canceling a paid order returns everything still outstanding, shipping
  // included. There is deliberately no "cancel without refunding".
  //
  // Outside the stock lock, because this is a network round-trip to Stripe and
  // the global checkout mutex must not wait on it. Canceling never needs that
  // lock anyway — it only releases stock, and releasing cannot oversell. It
  // could not be taken here safely either: refund() takes `payment:<id>`, and
  // withLock is not re-entrant, so nesting the two would invert the only lock
  // ordering this codebase has.
  //
  // BEFORE the status write, because that ordering's failure modes are both
  // survivable: a throw here means 409 and nothing changed. The reverse order
  // would fail silently.
  if (body.status === 'canceled' && before.status !== 'canceled' && before.payment_status === 'paid') {
    const remainder = before.total_cents - before.refunded_cents
    // A zero remainder must be a NO-OP, not an error. refund() rejects a zero
    // amount, so without this a retry after a failed status write — the exact
    // case the ordering above is designed to survive — would 400 forever.
    // No payment intent means there is nothing at Stripe to refund, and
    // refund() would throw 409 before the status write — leaving the order
    // PERMANENTLY UN-CANCELLABLE with a message that reads like a transient
    // failure. That is not hypothetical: the seeded demo orders are `paid` with
    // no intent because they predate Stripe, and markPaid() also writes a null
    // intent (with a warning) when a session completes without one.
    //
    // Cancelling has to win here. An admin who cannot cancel an order has no
    // way out; an admin who cancels one whose money we cannot return at least
    // has a log line and the Stripe dashboard. Loud, because if this fires on
    // an order that genuinely was charged, somebody has to refund it by hand.
    if (remainder > 0 && !before.stripe_payment_intent) {
      console.warn(
        `[cancel] order ${id} is paid but has no stripe_payment_intent — cancelling without a refund. ` +
        `If money was genuinely taken for it, refund it from the Stripe dashboard by hand.`,
      )
    }
    else if (remainder > 0) {
      const full = await readFullOrder(id)
      // refund() caps each line at quantity − refunded_quantity, so send what
      // is LEFT on the line, never its full quantity.
      const lines = full.items
        .filter(i => i.quantity - (i.refunded_quantity ?? 0) > 0)
        .map(i => ({ itemId: i.id, quantity: i.quantity - (i.refunded_quantity ?? 0) }))
      const lineTotal = full.items.reduce(
        (n, i) => n + i.unit_price_cents * (i.quantity - (i.refunded_quantity ?? 0)), 0)
      // Whatever the lines do not cover is the shipping remainder.
      //
      // The key is stable — `cancel:<order id>` — deliberately unlike the
      // per-attempt key the refund dialog sends: cancelling the same order
      // twice IS the duplicate that should be collapsed.
      await refund(id, lines, `cancel:${id}`, remainder - lineTotal)
    }
  }

  const data = await withStockLock(async () => {
    // Un-canceling a refunded order would hand you an open order whose money
    // has already gone back to the customer.
    if (before.status === 'canceled' && body.status !== 'canceled' && before.refunded_cents > 0) {
      throw createError({
        statusCode: 409,
        statusMessage: 'This order was refunded and cannot be reopened.',
      })
    }

    // Leaving `canceled` re-takes this order's stock. Under derived stock that
    // is not a constraint violation but a silent oversell, so check first.
    // The guard above means every reopenable order has refunded_quantity 0
    // throughout, so `quantity` here is already the amount being re-taken.
    if (before.status === 'canceled' && body.status !== 'canceled') {
      const lines = await db.request(readItems('eo_order_items', {
        fields: ['product', 'quantity'],
        filter: { order: { _eq: id } },
        limit: -1,
      }))
      const ids = [...new Set(lines.map(l => l.product).filter(Boolean))] as string[]
      // availabilityFor() counts every non-canceled order. This one is still
      // canceled, so its own lines are already excluded — do not add them back.
      const avail = await availabilityFor(ids)
      const short = ids.some((pid) => {
        const want = lines.filter(l => l.product === pid).reduce((n, l) => n + l.quantity, 0)
        return (avail.get(pid) ?? 0) < want
      })
      if (short) {
        throw createError({
          statusCode: 409,
          statusMessage: 'Cannot reopen this order — its items are no longer in stock.',
        })
      }
    }

    await db.request(updateItem('eo_orders', id, patch))
    // `as any`: the SDK cannot see through EoOrderItem.product's `| null` to
    // the relation, so it rejects the nested expansion at the type level only.
    return await db.request(readItem('eo_orders', id, {
      fields: ['*', { items: ['*', { product: ['id', 'slug', 'image'] }] }] as any,
    }))
  })

  // Fire-and-forget: a mail failure must never fail a status change that is already stored
  if (before.status !== body.status) {
    const send = body.status === 'marked'
      ? sendOrderShipped
      : body.status === 'canceled'
        ? sendOrderCanceled
        : null
    if (send) {
      event.waitUntil(
        send(data as any).catch(err =>
          console.error(`[mail] ${body.status} notice for ${data.order_number} failed:`, err),
        ),
      )
    }
  }

  return data
})
