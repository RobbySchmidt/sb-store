import { findCancelReason } from '../../../shared/utils/cancelReasons'
import { sendMail } from '../mailer'
import {
  CANCELED,
  ESPRESSO,
  MUTED,
  esc,
  itemLinesText,
  itemsSection,
  oneColSection,
  refundNoticeHtml,
  refundNoticeText,
  renderShell,
  renderShellText,
  totalsText,
  type OrderEmailOrder,
} from './shell'

/** The preset sentence and the free-text note, both only when actually usable. */
function reasonParts(order: OrderEmailOrder) {
  const sentence = findCancelReason(order.cancel_reason)?.sentence?.trim() ?? ''
  const note = typeof order.cancel_note === 'string' ? order.cancel_note.trim() : ''
  return { sentence, note, show: Boolean(sentence || note) }
}

export function buildOrderCanceled(order: OrderEmailOrder) {
  const subject = `Order ${order.order_number} has been canceled — Ember & Oak`

  const heading = 'Your order has been canceled'
  const refundedHtml = refundNoticeHtml(order)
  const refundedText = refundNoticeText(order)
  // A refunded order was definitely charged, so "Nothing has been charged"
  // would be a lie — drop it and let the refund sentence speak instead.
  const chargeLine = refundedText
    ? ''
    : 'Nothing has been charged. '
  const lead = `Order ${esc(order.order_number)} has been canceled. ${chargeLine}If this is unexpected, just reply to this mail and we'll sort it out.`

  const { sentence, note } = reasonParts(order)
  const show = Boolean(sentence || note || refundedHtml)

  const reasonHtml = show
    ? [`<!-- why -->
        ${oneColSection('WHY', [
          sentence
            ? `<p style="margin:0;font-size:14px;line-height:1.6;color:${ESPRESSO};">${esc(sentence)}</p>`
            : '',
          note
            ? `<p style="margin:${sentence ? '10px' : '0'} 0 0;font-size:14px;line-height:1.6;color:${MUTED};">${esc(note)}</p>`
            : '',
          refundedHtml,
        ].filter(Boolean).join('\n          '))}`]
    : []

  const html = renderShell({
    accent: CANCELED,
    heading,
    lead,
    orderNumber: order.order_number,
    sections: [
      ...reasonHtml,
      `<!-- items -->
        ${itemsSection(order, { totals: 'total-only' })}`,
    ],
  })

  const reasonText = show
    ? [`WHY\n${[sentence, note, refundedText].filter(Boolean).map(line => `  ${line}`).join('\n')}`]
    : []

  const text = renderShellText({
    heading,
    lead: `Order ${order.order_number} has been canceled. ${chargeLine}If this is unexpected, just reply to this mail and we'll sort it out.`,
    orderNumber: order.order_number,
    blocks: [
      ...reasonText,
      `YOUR ITEMS\n${itemLinesText(order)}`,
      totalsText(order, { totals: 'total-only' }),
    ],
  })

  return { subject, html, text }
}

/** Async so a synchronous mailer throw becomes a rejection the caller can .catch(). */
export async function sendOrderCanceled(order: OrderEmailOrder) {
  const { subject, html, text } = buildOrderCanceled(order)
  return sendMail({ to: order.email, subject, html, text })
}
