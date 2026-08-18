export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = supabaseAdmin()
  const select = '*, order_items(*)'

  // Two queries rather than one PostgREST .or(): that filter is built by
  // string concatenation, so an email containing a comma or a parenthesis
  // would silently corrupt it.
  const [byUser, byEmail] = await Promise.all([
    db.from('orders').select(select).eq('user_id', user.id),
    user.email
      ? db.from('orders').select(select).eq('email', user.email)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (byUser.error) throw createError({ statusCode: 500, statusMessage: byUser.error.message })
  if (byEmail.error) throw createError({ statusCode: 500, statusMessage: byEmail.error.message })

  const merged = new Map<string, any>()
  for (const order of [...(byUser.data ?? []), ...(byEmail.data ?? [])]) {
    merged.set(order.id, order)
  }

  return [...merged.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
})
