import { buildOrderConfirmation, type OrderEmailOrder } from '../../utils/orderEmail'

const SAMPLE: OrderEmailOrder = {
  order_number: 'EO-2026-0842',
  customer_name: 'Lena Hoffmann',
  email: 'lena.hoffmann@example.com',
  street: 'Lindenstraße 24',
  zip: '79098',
  city: 'Freiburg',
  country: 'Germany',
  subtotal_cents: 4680,
  shipping_cents: 490,
  total_cents: 5170,
  order_items: [
    { product_name: 'Ember Blend – Dark Roast 250g', unit_price_cents: 1490, quantity: 1 },
    { product_name: 'Sunrise Single Origin – Ethiopia 250g', unit_price_cents: 1650, quantity: 1 },
    { product_name: 'Honey Almond Granola 500g', unit_price_cents: 850, quantity: 1 },
    { product_name: '70% Dark Cacao Bar', unit_price_cents: 690, quantity: 1 },
  ],
}

/** Dev-only: renders the confirmation mail in the browser. 404s in production. */
export default defineEventHandler((event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  return buildOrderConfirmation(SAMPLE).html
})
