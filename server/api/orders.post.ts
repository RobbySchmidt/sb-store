import { FREE_SHIPPING_CENTS, SHIPPING_FLAT_CENTS } from '../../shared/utils/shop'
import { sendOrderConfirmation } from '../utils/email/confirmation'

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

  // Optional — guest checkout stays supported. currentUser() never throws.
  const user = await currentUser(event)

  // ---- price everything server-side from the live catalog ----
  const ids = items.map(i => i.productId)
  const { data: products, error: pErr } = await db
    .from('products').select('id, name, price_cents, stock, slug, image_url').in('id', ids)
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

  // ---- stock pre-check: a friendly 400 before anything is written ----
  const short = lines
    .map((l) => {
      const p = products.find(x => x.id === l.product_id)!
      return { name: p.name, want: l.quantity, have: p.stock }
    })
    .filter(s => s.have < s.want)

  if (short.length) {
    throw createError({
      statusCode: 400,
      statusMessage: short
        .map(s => s.have === 0 ? `${s.name} is out of stock` : `${s.name} — only ${s.have} left`)
        .join('; '),
    })
  }

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
      user_id: user?.id ?? null,
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
    // The stock trigger lost a race with a concurrent checkout: products_stock_non_negative
    if (iErr.code === '23514') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Someone just bought the last one — please check your cart and try again.',
      })
    }
    throw createError({ statusCode: 500, statusMessage: iErr.message })
  }

  // Display-only catalog fields for the confirmation page's thumbnails and links.
  // Deliberately NOT part of `lines` above — order_items has no such columns, and
  // name/price stay snapshotted because they are record data. Shaped like the
  // PostgREST join in /api/account/orders so both pages render the same way.
  const displayLines = lines.map((l) => {
    const p = products.find(x => x.id === l.product_id)!
    return { ...l, products: { slug: p.slug, image_url: p.image_url } }
  })

  // Fire-and-forget: a mail failure must never fail an order that is already in the database
  const full = { ...order, order_items: displayLines }
  event.waitUntil(
    sendOrderConfirmation(full).catch(err =>
      console.error(`[mail] confirmation for ${order.order_number} failed:`, err),
    ),
  )

  return full
})
