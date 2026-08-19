import { readItems, createItem, createItems, deleteItem, updateItem } from '@directus/sdk'
import { FREE_SHIPPING_CENTS, SHIPPING_FLAT_CENTS } from '../../shared/utils/shop'

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

  // Release stock from checkouts that were abandoned long enough ago. Runs
  // here because this is the one place a stale hold actually costs a sale.
  // markExpired()'s guard makes a redundant sweep free.
  await sweepExpired().catch(err => console.error('[sweep] failed:', err))

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

    // Sum the demand per product BEFORE comparing. `ids` is deduplicated but
    // `lines` is not, so two lines for the same product would each be checked
    // against the same availability figure and both pass independently: six in
    // stock, a body of [{X, qty:5}, {X, qty:5}], `6 < 5` false twice, and the
    // order inserts ten units. The lock does not help — it is not a race, it is
    // a comparison against the wrong number.
    //
    // The cart merges by productId (app/stores/cart.ts), so the UI cannot
    // produce this. The endpoint is public, so curl can.
    const wanted = new Map<string, { name: string, want: number }>()
    for (const l of lines) {
      const prev = wanted.get(l.product)
      wanted.set(l.product, {
        name: l.product_name,
        want: (prev?.want ?? 0) + l.quantity,
      })
    }
    const short = [...wanted.entries()]
      .map(([pid, w]) => ({ name: w.name, want: w.want, have: avail.get(pid) ?? 0 }))
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
      payment_status: 'pending',
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

  const full = { ...order, items: displayLines }

  /**
   * Undo a stored order that can never be paid.
   *
   * Leaving one behind is not cosmetic: it holds stock until the sweep reaches
   * it 45 minutes later, and the buyer — who just saw an error — will retry,
   * stranding another. Two retries against the last few bags hand a genuine
   * "only 1 left" to a different customer for stock nobody bought.
   *
   * CASCADE on eo_order_items.order takes the lines with it (setup.ts).
   * A failure here is logged rather than swallowed: it is precisely the case
   * where you would want to know why stock sat held.
   */
  const discardOrder = async (why: string, cause: unknown) => {
    console.error(`[checkout] discarding ${order.order_number} — ${why}:`, cause)
    await db.request(deleteItem('eo_orders', order.id)).catch(err =>
      console.error(`[checkout] cleanup of ${order.order_number} ALSO failed; it will hold stock until the sweep:`, err),
    )
  }

  // Stripe is called OUTSIDE the stock lock: a network round-trip in there
  // would serialise every checkout in the app behind Stripe's latency.
  let session
  try {
    session = await createCheckoutSession(full)
  } catch (e) {
    await discardOrder('Stripe session creation failed', e)
    throw createError({ statusCode: 502, statusMessage: 'Could not reach the payment provider. Nothing has been charged.' })
  }

  // `url` is typed nullable — Stripe only populates it while the session is
  // active. Always set for mode:'payment', but a null would mean the buyer
  // holds stock with nowhere to pay and no error raised, so treat it like any
  // other session failure rather than returning it.
  if (!session.url) {
    await discardOrder('Stripe returned a session with no URL', session.id)
    throw createError({ statusCode: 502, statusMessage: 'Could not reach the payment provider. Nothing has been charged.' })
  }

  // The third place an order can be orphaned. Without this the row survives
  // holding stock, with no session id for any webhook to reference, and the
  // buyer gets a raw 500 instead of the handled 502 above.
  try {
    await db.request(updateItem('eo_orders', order.id, { stripe_session_id: session.id }))
  } catch (e) {
    await discardOrder('could not record the Stripe session id', e)
    throw createError({ statusCode: 502, statusMessage: 'Could not start the payment. Nothing has been charged.' })
  }

  // No confirmation mail here any more — it moved to markPaid(). An order that
  // is never paid must never be confirmed.
  return { order: full, checkoutUrl: session.url }
})
