import { fmtPrice } from '../../../shared/utils/shop'

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
  refunded_cents?: number
  items: OrderEmailItem[]
  cancel_reason?: string | null
  cancel_note?: string | null
}

// Brand palette, mirrored from app/assets/css/main.css
export const ESPRESSO = '#2E211A'
export const CREAM = '#FAF6EF'
export const TERRA = '#C65F3D'
export const MUTED = '#7A6A5C'
export const LINE = '#E8DFD2'
export const MARKED = '#5C8A5C'
export const CANCELED = '#B0483B'
/** Colour for refund messaging. Between "shipped" green and "canceled" red. */
export const REFUND = '#9A7217'
// The site's Google Fonts are unreliable in mail clients — system stack instead
export const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 'Free' instead of €0.00 — used by both the HTML and the text totals. */
function shippingLabel(order: OrderEmailOrder): string {
  return order.shipping_cents === 0 ? 'Free' : fmtPrice(order.shipping_cents)
}

export interface ShellOptions {
  /** Colour of the ORDER № line — the one thing that differs per mail type. */
  accent: string
  /** HTML for the <h1>. Caller escapes anything it interpolates. */
  heading: string
  /** HTML for the paragraph under the heading. */
  lead: string
  /** Raw order number; escaped here. */
  orderNumber: string
  /**
   * Full `<tr><td>…</td></tr>` cards, indented like the ones the section
   * helpers below produce. Joined with a blank line between cards.
   */
  sections: string[]
}

/**
 * The chrome every Ember & Oak mail shares: header band with the wordmark,
 * greeting card, the caller's sections, demo-shop footer.
 */
export function renderShell(opts: ShellOptions): string {
  return `<!doctype html>
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
            ${opts.heading}
          </h1>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.7;color:${MUTED};">
            ${opts.lead}
          </p>
          <p style="margin:18px 0 0;font-size:11px;letter-spacing:0.1em;font-weight:600;color:${opts.accent};">
            ORDER № ${esc(opts.orderNumber)}
          </p>
        </td></tr>

        ${opts.sections.join('\n\n        ')}

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
}

export interface TotalsOptions {
  /** 'full' = Subtotal / Shipping / Total (default), 'total-only' = just the bold Total. */
  totals?: 'full' | 'total-only'
}

function totalRow(label: string, value: string, strong = false): string {
  return `
        <tr>
          <td style="padding:${strong ? '14px 0 0' : '10px 0 0'};font-size:${strong ? '16px' : '14px'};color:${strong ? ESPRESSO : MUTED};${strong ? 'font-weight:600;' : ''}">${label}</td>
          <td style="padding:${strong ? '14px 0 0' : '10px 0 0'};font-size:${strong ? '16px' : '14px'};color:${ESPRESSO};text-align:right;${strong ? 'font-weight:600;' : ''}">${value}</td>
        </tr>`
}

/** The white card listing every line item, followed by the totals rows. */
export function itemsSection(order: OrderEmailOrder, opts: TotalsOptions = {}): string {
  const itemRows = order.items.map(item => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid ${LINE};font-size:14px;color:${ESPRESSO};">
            ${esc(item.product_name)} × ${item.quantity}
          </td>
          <td style="padding:12px 0;border-bottom:1px solid ${LINE};font-size:14px;font-weight:600;color:${ESPRESSO};text-align:right;white-space:nowrap;">
            ${fmtPrice(item.unit_price_cents * item.quantity)}
          </td>
        </tr>`).join('')

  const totalRows = opts.totals === 'total-only'
    ? totalRow('Total', fmtPrice(order.total_cents), true)
    : [
        totalRow('Subtotal', fmtPrice(order.subtotal_cents)),
        totalRow('Shipping', shippingLabel(order)),
        totalRow('Total', fmtPrice(order.total_cents), true),
      ].join('\n            ')

  return `<tr><td style="background:#FFFFFF;padding:16px 32px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${itemRows}
            ${totalRows}
          </table>
        </td></tr>`
}

export interface SectionColumn {
  /** Small uppercase label above the column. */
  label: string
  /** HTML body of the column. */
  html: string
}

/** Two labelled columns side by side, e.g. DELIVERS TO / ESTIMATED DELIVERY. */
export function twoColSection(left: SectionColumn, right: SectionColumn): string {
  return `<tr><td style="background:#FFFFFF;padding:28px 32px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="50%" valign="top" style="padding-right:12px;">
                <p style="margin:0 0 8px;font-size:10px;letter-spacing:0.1em;font-weight:600;color:${MUTED};">${left.label}</p>
                ${left.html}
              </td>
              <td width="50%" valign="top" style="padding-left:12px;">
                <p style="margin:0 0 8px;font-size:10px;letter-spacing:0.1em;font-weight:600;color:${MUTED};">${right.label}</p>
                ${right.html}
              </td>
            </tr>
          </table>
        </td></tr>`
}

/** One labelled column filling the card width. */
export function oneColSection(label: string, html: string): string {
  return `<tr><td style="background:#FFFFFF;padding:28px 32px 32px;">
          <p style="margin:0 0 8px;font-size:10px;letter-spacing:0.1em;font-weight:600;color:${MUTED};">${label}</p>
          ${html}
        </td></tr>`
}

/** Escaped name / street / zip city, country — indented to sit inside a section column. */
export function addressHtml(order: OrderEmailOrder): string {
  return `${esc(order.customer_name)}<br>
                  ${esc(order.street)}<br>
                  ${esc(order.zip)} ${esc(order.city)}, ${esc(order.country)}`
}

export interface ShellTextOptions {
  heading: string
  lead: string
  orderNumber: string
  /** Text blocks, separated by a blank line each. */
  blocks: string[]
}

/** Plain-text counterpart of renderShell. Text is not markup — nothing is escaped. */
export function renderShellText(opts: ShellTextOptions): string {
  return `${opts.heading}

${opts.lead}

ORDER № ${opts.orderNumber}

${opts.blocks.join('\n\n')}

Ember & Oak is a demo shop — no real order was placed and nothing will be shipped.
`
}

export function itemLinesText(order: OrderEmailOrder): string {
  return order.items
    .map(item => `  ${item.product_name} × ${item.quantity}   ${fmtPrice(item.unit_price_cents * item.quantity)}`)
    .join('\n')
}

export function totalsText(order: OrderEmailOrder, opts: TotalsOptions = {}): string {
  const total = `  Total      ${fmtPrice(order.total_cents)}`
  if (opts.totals === 'total-only') return total
  return `  Subtotal   ${fmtPrice(order.subtotal_cents)}
  Shipping   ${shippingLabel(order)}
${total}`
}

export function addressText(order: OrderEmailOrder): string {
  return `  ${order.customer_name}
  ${order.street}
  ${order.zip} ${order.city}, ${order.country}`
}

/** One refunded line as the refund mails describe it. */
export interface RefundEmailLine {
  product_name: string
  quantity: number
  amount_cents: number
}

/**
 * The refund sentence for the cancellation mail. Empty when nothing was
 * returned, so the caller can drop the whole block.
 */
export function refundNoticeHtml(order: OrderEmailOrder): string {
  const cents = order.refunded_cents ?? 0
  if (cents <= 0) return ''
  return `<p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:${ESPRESSO};">`
    + `We've refunded <strong>${esc(fmtPrice(cents))}</strong> to your original payment method. `
    + `It usually appears within 5–10 business days.</p>`
}

export function refundNoticeText(order: OrderEmailOrder): string {
  const cents = order.refunded_cents ?? 0
  if (cents <= 0) return ''
  return `We've refunded ${fmtPrice(cents)} to your original payment method. `
    + `It usually appears within 5-10 business days.`
}

/** The lines covered by one refund, for the partial-refund mail. */
export function refundedLinesHtml(lines: RefundEmailLine[]): string {
  return lines.map(l =>
    `<p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:${ESPRESSO};">`
    + `${esc(l.product_name)} × ${l.quantity} — ${esc(fmtPrice(l.amount_cents))}</p>`,
  ).join('\n          ')
}

export function refundedLinesText(lines: RefundEmailLine[]): string {
  return lines.map(l => `  ${l.product_name} x ${l.quantity} — ${fmtPrice(l.amount_cents)}`).join('\n')
}
