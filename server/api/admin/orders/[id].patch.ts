const VALID_STATUSES = ['open', 'marked', 'canceled'] as const

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ status?: string }>(event)

  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid order id' })
  }
  if (!body?.status || !VALID_STATUSES.includes(body.status as any)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid status' })
  }

  const db = supabaseAdmin()
  const { data, error } = await db
    .from('orders')
    .update({ status: body.status })
    .eq('id', id)
    .select('*, order_items(*)')
    .single()
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return data
})
