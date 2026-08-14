const FREE_SHIPPING_CENTS = 4900
const SHIPPING_FLAT_CENTS = 490

interface OrderPayload {
  customer: {
    firstName: string
    lastName: string
    email: string
    street: string
    zip: string
    city: string
    country: string
  }
  items: { productId: string; qty: number }[]
}

export default defineEventHandler(async (event) => {
  const body = await readBody<OrderPayload>(event)

  // ---- validate payload ----
  const c = body?.customer
  const required = ['firstName', 'lastName', 'email', 'street', 'zip', 'city', 'country'] as const
  if (!c || required.some(k => typeof c[k] !== 'string' || !c[k].trim())) {
    throw createError({ statusCode: 400, statusMessage: 'Missing customer fields' })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid email address' })
  }
  const items = body?.items
  if (!Array.isArray(items) || items.length === 0 ||
    items.some(i => typeof i.productId !== 'string' || !Number.isInteger(i.qty) || i.qty < 1 || i.qty > 99)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid cart items' })
  }

  const db = supabaseAdmin()

  // ---- price everything server-side from the live catalog ----
  const ids = items.map(i => i.productId)
  const { data: products, error: pErr } = await db
    .from('products').select('id, name, price_cents').in('id', ids)
  if (pErr) throw createError({ statusCode: 500, statusMessage: pErr.message })
  if (!products || products.length !== new Set(ids).size) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown product in cart' })
  }

  const lines = items.map((i) => {
    const p = products.find(x => x.id === i.productId)!
    return { product_id: p.id, product_name: p.name, unit_price_cents: p.price_cents, quantity: i.qty }
  })
  const subtotal = lines.reduce((n, l) => n + l.unit_price_cents * l.quantity, 0)
  const shipping = subtotal >= FREE_SHIPPING_CENTS ? 0 : SHIPPING_FLAT_CENTS
  const total = subtotal + shipping

  // ---- create order + items ----
  const { data: order, error: oErr } = await db
    .from('orders')
    .insert({
      customer_name: `${c.firstName.trim()} ${c.lastName.trim()}`,
      email: c.email.trim(),
      street: c.street.trim(),
      zip: c.zip.trim(),
      city: c.city.trim(),
      country: c.country.trim(),
      subtotal_cents: subtotal,
      shipping_cents: shipping,
      total_cents: total,
    })
    .select()
    .single()
  if (oErr) throw createError({ statusCode: 500, statusMessage: oErr.message })

  const { error: iErr } = await db
    .from('order_items')
    .insert(lines.map(l => ({ ...l, order_id: order.id })))
  if (iErr) {
    await db.from('orders').delete().eq('id', order.id)
    throw createError({ statusCode: 500, statusMessage: iErr.message })
  }

  return { ...order, order_items: lines }
})
