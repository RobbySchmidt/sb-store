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
  const before = await db.request(readItem('eo_orders', id, { fields: ['status'] }))
    .catch(() => null)
  if (!before) throw createError({ statusCode: 404, statusMessage: 'Order not found' })

  // The reason columns belong to a cancellation and are cleared by any other status
  const patch = body.status === 'canceled'
    ? { status: body.status, cancel_reason: reason, cancel_note: note }
    : { status: body.status, cancel_reason: null, cancel_note: null }

  const data = await withStockLock(async () => {
    // Leaving `canceled` re-takes this order's stock. Under derived stock that
    // is not a constraint violation but a silent oversell, so check first.
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
