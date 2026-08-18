import { readItems, createItem, createItems, deleteItem } from '@directus/sdk'
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

/** EO-2026-0849. Called inside the stock lock, so the read-max is safe. */
async function nextOrderNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `EO-${year}-`
  const last = await directus().request(readItems('eo_orders', {
    fields: ['order_number'],
    filter: { order_number: { _starts_with: prefix } },
    sort: ['-order_number'],
    limit: 1,
  }))
  const n = last.length ? Number(last[0]!.order_number.slice(prefix.length)) + 1 : 841
  return `${prefix}${String(n).padStart(4, '0')}`
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

  const db = directus()

  // Optional — guest checkout stays supported. currentUser() never throws.
  const user = await currentUser(event)

  // ---- price everything server-side from the live catalog ----
  const ids = [...new Set(items.map(i => i.productId))]
  const products = await db.request(readItems('eo_products', {
    fields: ['id', 'name', 'price_cents', 'slug', 'image'],
    filter: { id: { _in: ids } },
    limit: -1,
  }))
  if (products.length !== ids.length) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown product in cart' })
  }

  const lines = items.map((i) => {
    const p = products.find(x => x.id === i.productId)!
    return { product: p.id, product_name: p.name, unit_price_cents: p.price_cents, quantity: i.qty }
  })
  const subtotal = lines.reduce((n, l) => n + l.unit_price_cents * l.quantity, 0)
  const shipping = subtotal >= FREE_SHIPPING_CENTS ? 0 : SHIPPING_FLAT_CENTS
  const total = subtotal + shipping

  // ---- everything that must not race, in one critical section ----
  // Stock is derived, so there is nothing to decrement: checkout is insert-only
  // and the check below is the only thing standing between two concurrent
  // carts and an oversell.
  const order = await withStockLock(async () => {
    const avail = await availabilityFor(ids)
    const short = lines
      .map(l => ({ name: l.product_name, want: l.quantity, have: avail.get(l.product) ?? 0 }))
      .filter(s => s.have < s.want)

    if (short.length) {
      throw createError({
        statusCode: 400,
        statusMessage: short
          .map(s => s.have === 0 ? `${s.name} is out of stock` : `${s.name} — only ${s.have} left`)
          .join('; '),
      })
    }

    const created = await db.request(createItem('eo_orders', {
      order_number: await nextOrderNumber(),
      customer_name: `${c.firstName.trim()} ${c.lastName.trim()}`,
      email: c.email.trim(),
      street: c.street.trim(),
      zip: c.zip.trim(),
      city: c.city.trim(),
      country: c.country.trim(),
      user: user?.id ?? null,
      subtotal_cents: subtotal,
      shipping_cents: shipping,
      total_cents: total,
    }))

    try {
      await db.request(createItems('eo_order_items', lines.map(l => ({ ...l, order: created.id }))))
    } catch (e) {
      // Directus does not wrap these two calls in a transaction, so an orphan
      // order is possible. Clean it up rather than leaving a phantom.
      await db.request(deleteItem('eo_orders', created.id)).catch(() => {})
      throw e
    }
    return created
  })

  // Display fields for the confirmation page's thumbnails and links. Shaped
  // like the expanded relation /api/account/orders returns, so both pages
  // render the same way. Name and price stay snapshotted on the line itself.
  const displayLines = lines.map((l) => {
    const p = products.find(x => x.id === l.product)!
    return { ...l, product: { id: p.id, slug: p.slug, image: p.image } }
  })

  // Fire-and-forget: a mail failure must never fail an order that is already stored
  const full = { ...order, items: displayLines }
  event.waitUntil(
    sendOrderConfirmation(full as any).catch(err =>
      console.error(`[mail] confirmation for ${order.order_number} failed:`, err),
    ),
  )

  return full
})
