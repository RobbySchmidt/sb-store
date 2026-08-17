import { isCancelReasonKey } from '../../../../shared/utils/cancelReasons'
import { sendOrderCanceled } from '../../../utils/email/canceled'
import { sendOrderShipped } from '../../../utils/email/shipped'

const VALID_STATUSES = ['open', 'marked', 'canceled'] as const

const NOTE_MAX = 500

export default defineEventHandler(async (event) => {
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

  const db = supabaseAdmin()

  // Read the status we are coming from, so the mail only fires on a real transition
  const { data: before } = await db
    .from('orders')
    .select('status')
    .eq('id', id)
    .single()
  if (!before) throw createError({ statusCode: 404, statusMessage: 'Order not found' })

  // The reason columns belong to a cancellation and are cleared by any other status
  const patch = body.status === 'canceled'
    ? { status: body.status, cancel_reason: reason, cancel_note: note }
    : { status: body.status, cancel_reason: null, cancel_note: null }

  const { data, error } = await db
    .from('orders')
    .update(patch)
    .eq('id', id)
    .select('*, order_items(*)')
    .single()
  if (error) {
    // Leaving `canceled` re-takes the stock via trigger and can hit products_stock_non_negative
    if (error.code === '23514') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Cannot reopen this order — its items are no longer in stock.',
      })
    }
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  // Fire-and-forget: a mail failure must never fail a status change that is already stored
  if (before.status !== body.status) {
    const send = body.status === 'marked'
      ? sendOrderShipped
      : body.status === 'canceled'
        ? sendOrderCanceled
        : null
    if (send) {
      event.waitUntil(
        send(data).catch(err =>
          console.error(`[mail] ${body.status} notice for ${data.order_number} failed:`, err),
        ),
      )
    }
  }

  return data
})
