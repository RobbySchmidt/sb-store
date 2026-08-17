import { batchInfo } from '../../../shared/utils/shop'
import { sendMail } from '../mailer'
import {
  ESPRESSO,
  MARKED,
  MUTED,
  addressHtml,
  addressText,
  esc,
  itemLinesText,
  itemsSection,
  renderShell,
  renderShellText,
  totalsText,
  twoColSection,
  type OrderEmailOrder,
} from './shell'

export function buildOrderShipped(order: OrderEmailOrder) {
  const batch = batchInfo()
  const firstName = order.customer_name.trim().split(' ')[0] ?? ''
  const subject = `Order ${order.order_number} is on its way — Ember & Oak`

  const heading = `Your coffee is on its way${firstName ? `, ${esc(firstName)}` : ''}!`
  const lead = `Roasted in batch #${batch.number}, packed and handed over to the carrier. Estimated delivery ${batch.deliveryHuman}.`

  const html = renderShell({
    accent: MARKED,
    heading,
    lead,
    orderNumber: order.order_number,
    sections: [
      `<!-- items -->
        ${itemsSection(order, { totals: 'total-only' })}`,
      `<!-- delivery -->
        ${twoColSection(
          {
            label: 'DELIVERS TO',
            html: `<p style="margin:0;font-size:14px;line-height:1.6;color:${ESPRESSO};">
                  ${addressHtml(order)}
                </p>`,
          },
          {
            label: 'ESTIMATED DELIVERY',
            html: `<p style="margin:0;font-size:18px;font-weight:600;color:${ESPRESSO};">${batch.deliveryHuman}</p>
                <p style="margin:6px 0 0;font-size:13px;color:${MUTED};">Roasted in batch #${batch.number}</p>`,
          },
        )}`,
    ],
  })

  const text = renderShellText({
    heading: `Your coffee is on its way${firstName ? `, ${firstName}` : ''}!`,
    lead: `Roasted in batch #${batch.number}, packed and handed over to the carrier. Estimated delivery ${batch.deliveryHuman}.`,
    orderNumber: order.order_number,
    blocks: [
      `YOUR ITEMS\n${itemLinesText(order)}`,
      totalsText(order, { totals: 'total-only' }),
      `DELIVERS TO\n${addressText(order)}`,
      `ESTIMATED DELIVERY\n  ${batch.deliveryHuman}`,
    ],
  })

  return { subject, html, text }
}

/** Async so a synchronous mailer throw becomes a rejection the caller can .catch(). */
export async function sendOrderShipped(order: OrderEmailOrder) {
  const { subject, html, text } = buildOrderShipped(order)
  return sendMail({ to: order.email, subject, html, text })
}
