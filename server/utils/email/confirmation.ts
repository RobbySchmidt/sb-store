import { batchInfo } from '../../../shared/utils/shop'
import { sendMail } from '../mailer'
import {
  ESPRESSO,
  MUTED,
  TERRA,
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

export function buildOrderConfirmation(order: OrderEmailOrder) {
  const batch = batchInfo()
  const firstName = order.customer_name.trim().split(' ')[0] ?? ''
  const subject = `Order ${order.order_number} confirmed — Ember & Oak`

  const heading = `Thank you${firstName ? `, ${esc(firstName)}` : ''}!`
  const lead = `Your order is in. We'll roast on ${batch.nextRoastHuman} and ship within 48 hours.`

  const html = renderShell({
    accent: TERRA,
    heading,
    lead,
    orderNumber: order.order_number,
    sections: [
      `<!-- items -->
        ${itemsSection(order)}`,
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
                <p style="margin:6px 0 0;font-size:13px;color:${MUTED};">Roasted fresh on ${batch.nextRoastHuman}</p>`,
          },
        )}`,
    ],
  })

  const text = renderShellText({
    heading: `Thank you${firstName ? `, ${firstName}` : ''}!`,
    lead: `Your order is in. We'll roast on ${batch.nextRoastHuman} and ship within 48 hours.`,
    orderNumber: order.order_number,
    blocks: [
      `YOUR ITEMS\n${itemLinesText(order)}`,
      totalsText(order),
      `DELIVERS TO\n${addressText(order)}`,
      `ESTIMATED DELIVERY\n  ${batch.deliveryHuman} — roasted fresh on ${batch.nextRoastHuman}`,
    ],
  })

  return { subject, html, text }
}

/** Async so a synchronous mailer throw becomes a rejection the caller can .catch(). */
export async function sendOrderConfirmation(order: OrderEmailOrder) {
  const { subject, html, text } = buildOrderConfirmation(order)
  return sendMail({ to: order.email, subject, html, text })
}
