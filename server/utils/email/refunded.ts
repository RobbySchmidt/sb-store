import { sendMail } from '../mailer'
import { fmtPrice } from '../../../shared/utils/shop'
import {
  REFUND,
  esc,
  itemLinesText,
  itemsSection,
  oneColSection,
  refundedLinesHtml,
  refundedLinesText,
  renderShell,
  renderShellText,
  totalsText,
  type OrderEmailOrder,
  type RefundEmailLine,
} from './shell'

/**
 * What one refund covered. Structurally the `RefundResult` that
 * `refund()` in `server/utils/payments.ts` returns — declared here as only
 * what the mail reads, so the route can pass its result straight through.
 */
export interface RefundSummary {
  amountCents: number
  lines: RefundEmailLine[]
}

export function buildOrderRefunded(order: OrderEmailOrder, refund: RefundSummary) {
  const subject = `A refund for order ${order.order_number} is on its way — Ember & Oak`

  const heading = 'We’ve refunded part of your order'
  const leadPlain = `We've refunded ${fmtPrice(refund.amountCents)} for order ${order.order_number}. `
    + `It usually appears on your original payment method within 5-10 business days. `
    + `The rest of your order is unaffected.`

  const html = renderShell({
    accent: REFUND,
    heading,
    lead: esc(leadPlain),
    orderNumber: order.order_number,
    sections: [
      `<!-- refunded -->
        ${oneColSection('REFUNDED', refundedLinesHtml(refund.lines))}`,
      `<!-- items -->
        ${itemsSection(order, { totals: 'total-only' })}`,
    ],
  })

  const text = renderShellText({
    heading,
    lead: leadPlain,
    orderNumber: order.order_number,
    blocks: [
      `REFUNDED\n${refundedLinesText(refund.lines)}`,
      `YOUR ITEMS\n${itemLinesText(order)}`,
      totalsText(order, { totals: 'total-only' }),
    ],
  })

  return { subject, html, text }
}

/** Async so a synchronous mailer throw becomes a rejection the caller can .catch(). */
export async function sendOrderRefunded(order: OrderEmailOrder, refund: RefundSummary) {
  const { subject, html, text } = buildOrderRefunded(order, refund)
  return sendMail({ to: order.email, subject, html, text })
}
