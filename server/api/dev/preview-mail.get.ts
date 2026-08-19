import { buildOrderCanceled } from '../../utils/email/canceled'
import { buildOrderConfirmation } from '../../utils/email/confirmation'
import { buildOrderRefunded } from '../../utils/email/refunded'
import { buildOrderShipped } from '../../utils/email/shipped'
import type { OrderEmailOrder } from '../../utils/email/shell'

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
  items: [
    { product_name: 'Ember Blend – Dark Roast 250g', unit_price_cents: 1490, quantity: 1 },
    { product_name: 'Sunrise Single Origin – Ethiopia 250g', unit_price_cents: 1650, quantity: 1 },
    { product_name: 'Honey Almond Granola 500g', unit_price_cents: 850, quantity: 1 },
    { product_name: '70% Dark Cacao Bar', unit_price_cents: 690, quantity: 1 },
  ],
}

/**
 * Dev-only: renders one of the order mails in the browser. 404s in production.
 *
 * ?template=confirmation (default) | shipped | canceled | refunded
 * ?reason=none  — canceled only: drop reason and note, to preview the bare variant.
 *                 Also drops the refund, so both wordings of the charge line
 *                 ("Nothing has been charged" vs. the refund notice) can be seen.
 */
export default defineEventHandler((event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  const { template = 'confirmation', reason } = getQuery(event)

  let html: string
  switch (template) {
    case 'confirmation':
      html = buildOrderConfirmation(SAMPLE).html
      break
    case 'shipped':
      html = buildOrderShipped(SAMPLE).html
      break
    case 'refunded':
      html = buildOrderRefunded(
        { ...SAMPLE, refunded_cents: 1650 },
        {
          amountCents: 1650,
          lines: [{
            product_name: 'Sunrise Single Origin – Ethiopia 250g',
            quantity: 1,
            amount_cents: 1650,
          }],
        },
      ).html
      break
    case 'canceled':
      html = buildOrderCanceled(
        reason === 'none'
          ? { ...SAMPLE, cancel_reason: null, cancel_note: null }
          : {
              ...SAMPLE,
              cancel_reason: 'out_of_stock',
              cancel_note: 'The Ethiopia lot sold out faster than we expected — sorry!',
              // Preview the paid-and-refunded wording, which must NOT claim
              // that nothing was charged.
              refunded_cents: SAMPLE.total_cents,
            },
      ).html
      break
    default:
      throw createError({ statusCode: 400, statusMessage: `Unknown template: ${String(template)}` })
  }

  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  return html
})
