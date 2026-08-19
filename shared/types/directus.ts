export interface EoCategory {
  id: string
  name: string
  slug: string
  sort_order: number
  date_created: string
}

export interface ProductMeta {
  weight_g?: number
  meta_line?: string
  roast_pct?: number
  flavors?: string[]
}

export interface EoProduct {
  id: string
  /** An id unless the query expands it. /api/catalog expands id+name+slug. */
  category: string | Pick<EoCategory, 'id' | 'name' | 'slug'>
  name: string
  slug: string
  tagline: string | null
  description: string | null
  price_cents: number
  /** directus_files id. Build a URL with assetUrl(). */
  image: string | null
  is_active: boolean
  meta: ProductMeta
  stock_initial: number
  date_created: string
  /** Computed by /api/catalog — never a stored column. */
  stock_available?: number
}

export type OrderStatus = 'open' | 'marked' | 'canceled'

export type PaymentStatus = 'pending' | 'paid' | 'expired'

export interface EoOrderItem {
  id: string
  order: string | EoOrder
  /** Live catalog relation, for the thumbnail and link only. Null once the
   *  product is deleted — name and price stay snapshotted on this row. */
  product: string | Pick<EoProduct, 'id' | 'slug' | 'image'> | null
  product_name: string
  unit_price_cents: number
  quantity: number
  /** How many of `quantity` have been refunded. Comes off the held stock total. */
  refunded_quantity: number
}

export interface EoOrder {
  id: string
  order_number: string
  status: OrderStatus
  customer_name: string
  email: string
  street: string
  zip: string
  city: string
  country: string
  user: string | null
  subtotal_cents: number
  shipping_cents: number
  total_cents: number
  payment_status: PaymentStatus
  /** Stripe Checkout Session id. Null only in the brief window in
   *  /api/orders between inserting the order and creating the session. */
  stripe_session_id: string | null
  stripe_payment_intent: string | null
  paid_at: string | null
  /** Accumulated across every refund. Refund state is DERIVED from this
   *  against total_cents — there is no `refunded` payment_status. */
  refunded_cents: number
  refunded_at: string | null
  cancel_reason: string | null
  cancel_note: string | null
  date_created: string
  /** Directus special field — in practice when the status last changed,
   *  which is what the shipped delivery estimate counts from. */
  date_updated: string
  items: EoOrderItem[]
}

export interface Schema {
  eo_categories: EoCategory[]
  eo_products: EoProduct[]
  eo_orders: EoOrder[]
  eo_order_items: EoOrderItem[]
}

/** The signed-in person, normalised. Returned by /api/auth/me. */
export interface SessionUser {
  id: string
  email: string | null
  isAdmin: boolean
}
