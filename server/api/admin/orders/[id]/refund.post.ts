// The email modules under server/utils/email/ are imported explicitly in this
// codebase — see orders.post.ts and [id].patch.ts. Only top-level
// server/utils/*.ts is auto-imported, which is where refund() and
// readFullOrder() come from.
import { sendOrderRefunded } from '../../../../utils/email/refunded'

/**
 * Partial refund. Its own route, not part of the status PATCH: it is not a
 * status change, it can be repeated, and the order stays open and shippable
 * afterwards.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid order id' })
  }

  const body = await readBody<{ requestId?: string, lines?: Array<{ itemId: string, quantity: number }> }>(event)

  // The idempotency key comes from the client so a retried submit reuses it.
  if (typeof body?.requestId !== 'string' || body.requestId.length < 8 || body.requestId.length > 100) {
    throw createError({ statusCode: 400, statusMessage: 'Missing or invalid requestId' })
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No lines to refund' })
  }
  // Shape-check each entry here rather than letting refund() dereference it.
  // `{"lines":[null]}` would otherwise throw a TypeError reading `l.itemId` and
  // surface as a 500 — a malformed request deserves a 400, and a 500 on a money
  // route is the kind of thing someone chases for an hour.
  if (body.lines.some(l => !l || typeof l.itemId !== 'string' || typeof l.quantity !== 'number')) {
    throw createError({ statusCode: 400, statusMessage: 'Each line needs an itemId and a quantity' })
  }

  // Every remaining guard — unknown line, duplicate line, bad quantity, over
  // the order total, order not paid — lives in refund(), which throws
  // createError with the right status and writes nothing when it does. Letting
  // those propagate is deliberate: rewrapping them here would only blur
  // messages that are already correct.
  const result = await refund(id, body.lines, body.requestId)

  const order = await readFullOrder(id)
  event.waitUntil(
    sendOrderRefunded(order, result).catch(err =>
      console.error(`[mail] refund notice for ${order.order_number} failed:`, err),
    ),
  )

  return { order, refund: result }
})
