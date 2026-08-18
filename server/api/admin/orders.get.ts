export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const db = supabaseAdmin()
  const { data, error } = await db
    .from('orders')
    .select('*, order_items(*)')
    .order('created_at', { ascending: false })
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return data
})
