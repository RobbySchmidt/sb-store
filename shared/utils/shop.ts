export const FREE_SHIPPING_CENTS = 4900
export const SHIPPING_FLAT_CENTS = 490

export function fmtPrice(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`
}

/**
 * Customer-facing order status. Deliberately different wording from the
 * admin dashboard's STATUS map — it reuses the language the customer has
 * already been sent by mail ("confirmed", "on its way").
 */
export function customerOrderStatus(status: 'open' | 'marked' | 'canceled'): string {
  if (status === 'marked') return 'On its way'
  if (status === 'canceled') return 'Canceled'
  return 'Confirmed'
}

export const LOW_STOCK_THRESHOLD = 5

export type StockTone = 'out' | 'low' | 'ok'

export function stockTone(stock: number): StockTone {
  if (stock <= 0) return 'out'
  return stock <= LOW_STOCK_THRESHOLD ? 'low' : 'ok'
}

/** Card/detail label: "OUT OF STOCK" · "ONLY 3 LEFT" · "12 LEFT" */
export function stockLabel(stock: number): string {
  if (stock <= 0) return 'OUT OF STOCK'
  return stock <= LOW_STOCK_THRESHOLD ? `ONLY ${stock} LEFT` : `${stock} LEFT`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function lastTuesday(from = new Date()): Date {
  const d = new Date(from)
  // getDay(): Tue = 2
  const diff = (d.getDay() - 2 + 7) % 7
  d.setDate(d.getDate() - diff)
  return d
}

function nextTuesday(from = new Date()): Date {
  const d = new Date(from)
  const diff = (2 - d.getDay() + 7) % 7 || 7
  d.setDate(d.getDate() + diff)
  return d
}

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

/** Batch info used in the announcement bar, cart, confirmation page and email */
export function batchInfo(now = new Date()) {
  const roasted = lastTuesday(now)
  const upcoming = nextTuesday(now)
  const delivStart = new Date(upcoming); delivStart.setDate(upcoming.getDate() + 2)
  const delivEnd = new Date(upcoming); delivEnd.setDate(upcoming.getDate() + 3)
  const short = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]!.toUpperCase()}`
  const human = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return {
    number: isoWeek(now) + 181,
    roastedShort: `TUE ${short(roasted)}`,          // TUE 11 AUG
    nextRoastHuman: `Tuesday, ${human(upcoming)}`,  // Tuesday, Aug 18
    deliveryHuman: `Thu–Fri, ${human(delivStart)}–${delivEnd.getDate()}`,
  }
}
