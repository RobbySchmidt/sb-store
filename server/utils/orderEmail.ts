import { fmtPrice, batchInfo } from '../../shared/utils/shop'
import { sendMail } from './mailer'

export interface OrderEmailItem {
  product_name: string
  unit_price_cents: number
  quantity: number
}

export interface OrderEmailOrder {
  order_number: string
  customer_name: string
  email: string
  street: string
  zip: string
  city: string
  country: string
  subtotal_cents: number
  shipping_cents: number
  total_cents: number
  order_items: OrderEmailItem[]
}

// Brand palette, mirrored from app/assets/css/main.css
const ESPRESSO = '#2E211A'
const CREAM = '#FAF6EF'
const TERRA = '#C65F3D'
const MUTED = '#7A6A5C'
const LINE = '#E8DFD2'
// The site's Google Fonts are unreliable in mail clients — system stack instead
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildOrderConfirmation(order: OrderEmailOrder) {
  const batch = batchInfo()
  const firstName = order.customer_name.trim().split(' ')[0] ?? ''
  const shipping = order.shipping_cents === 0 ? 'Free' : fmtPrice(order.shipping_cents)
  const subject = `Order ${order.order_number} confirmed — Ember & Oak`

  const itemRows = order.order_items.map(item => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid ${LINE};font-size:14px;color:${ESPRESSO};">
            ${esc(item.product_name)} × ${item.quantity}
          </td>
          <td style="padding:12px 0;border-bottom:1px solid ${LINE};font-size:14px;font-weight:600;color:${ESPRESSO};text-align:right;white-space:nowrap;">
            ${fmtPrice(item.unit_price_cents * item.quantity)}
          </td>
        </tr>`).join('')

  const totalRow = (label: string, value: string, strong = false) => `
        <tr>
          <td style="padding:${strong ? '14px 0 0' : '10px 0 0'};font-size:${strong ? '16px' : '14px'};color:${strong ? ESPRESSO : MUTED};${strong ? 'font-weight:600;' : ''}">${label}</td>
          <td style="padding:${strong ? '14px 0 0' : '10px 0 0'};font-size:${strong ? '16px' : '14px'};color:${ESPRESSO};text-align:right;${strong ? 'font-weight:600;' : ''}">${value}</td>
        </tr>`

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${CREAM};font-family:${FONT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- header band -->
        <tr><td style="background:${ESPRESSO};border-radius:14px 14px 0 0;padding:28px 32px;">
          <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${TERRA};"></span>
          <span style="font-size:19px;font-weight:600;color:${CREAM};padding-left:8px;">Ember &amp; Oak</span>
        </td></tr>

        <!-- greeting -->
        <tr><td style="background:#FFFFFF;padding:32px 32px 8px;">
          <h1 style="margin:0;font-size:26px;font-weight:600;color:${ESPRESSO};">
            Thank you${firstName ? `, ${esc(firstName)}` : ''}!
          </h1>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.7;color:${MUTED};">
            Your order is in. We'll roast on ${batch.nextRoastHuman} and ship within 48 hours.
          </p>
          <p style="margin:18px 0 0;font-size:11px;letter-spacing:0.1em;font-weight:600;color:${TERRA};">
            ORDER № ${esc(order.order_number)}
          </p>
        </td></tr>

        <!-- items -->
        <tr><td style="background:#FFFFFF;padding:16px 32px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${itemRows}
            ${totalRow('Subtotal', fmtPrice(order.subtotal_cents))}
            ${totalRow('Shipping', shipping)}
            ${totalRow('Total', fmtPrice(order.total_cents), true)}
          </table>
        </td></tr>

        <!-- delivery -->
        <tr><td style="background:#FFFFFF;padding:28px 32px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="50%" valign="top" style="padding-right:12px;">
                <p style="margin:0 0 8px;font-size:10px;letter-spacing:0.1em;font-weight:600;color:${MUTED};">DELIVERS TO</p>
                <p style="margin:0;font-size:14px;line-height:1.6;color:${ESPRESSO};">
                  ${esc(order.customer_name)}<br>
                  ${esc(order.street)}<br>
                  ${esc(order.zip)} ${esc(order.city)}, ${esc(order.country)}
                </p>
              </td>
              <td width="50%" valign="top" style="padding-left:12px;">
                <p style="margin:0 0 8px;font-size:10px;letter-spacing:0.1em;font-weight:600;color:${MUTED};">ESTIMATED DELIVERY</p>
                <p style="margin:0;font-size:18px;font-weight:600;color:${ESPRESSO};">${batch.deliveryHuman}</p>
                <p style="margin:6px 0 0;font-size:13px;color:${MUTED};">Roasted fresh on ${batch.nextRoastHuman}</p>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- footer -->
        <tr><td style="background:#FFFFFF;border-radius:0 0 14px 14px;border-top:1px solid ${LINE};padding:20px 32px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};">
            Ember &amp; Oak is a demo shop — no real order was placed and nothing will be shipped.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  const itemLines = order.order_items
    .map(item => `  ${item.product_name} × ${item.quantity}   ${fmtPrice(item.unit_price_cents * item.quantity)}`)
    .join('\n')

  const text = `Thank you${firstName ? `, ${firstName}` : ''}!

Your order is in. We'll roast on ${batch.nextRoastHuman} and ship within 48 hours.

ORDER № ${order.order_number}

YOUR ITEMS
${itemLines}

  Subtotal   ${fmtPrice(order.subtotal_cents)}
  Shipping   ${shipping}
  Total      ${fmtPrice(order.total_cents)}

DELIVERS TO
  ${order.customer_name}
  ${order.street}
  ${order.zip} ${order.city}, ${order.country}

ESTIMATED DELIVERY
  ${batch.deliveryHuman} — roasted fresh on ${batch.nextRoastHuman}

Ember & Oak is a demo shop — no real order was placed and nothing will be shipped.
`

  return { subject, html, text }
}

export function sendOrderConfirmation(order: OrderEmailOrder) {
  const { subject, html, text } = buildOrderConfirmation(order)
  return sendMail({ to: order.email, subject, html, text })
}
