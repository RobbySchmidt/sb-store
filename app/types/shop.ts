export interface Category {
  id: string
  name: string
  slug: string
  sort_order: number
}

export interface ProductMeta {
  weight_g?: number
  meta_line?: string
  roast_pct?: number
  flavors?: string[]
}

export interface Product {
  id: string
  category_id: string
  name: string
  slug: string
  tagline: string | null
  description: string | null
  price_cents: number
  image_url: string | null
  is_active: boolean
  stock: number
  meta: ProductMeta
  categories?: { name: string; slug: string } | null
}

export interface CartItem {
  productId: string
  slug: string
  name: string
  unitPriceCents: number
  image: string | null
  qty: number
}

export type OrderStatus = 'open' | 'marked' | 'canceled'

export interface OrderItem {
  id: string
  product_id: string | null
  product_name: string
  unit_price_cents: number
  quantity: number
  /** Live catalog join, for the thumbnail and the link only. Null once the
   *  product is deleted — name and price stay snapshotted on the row above. */
  products?: { slug: string; image_url: string | null } | null
}

export interface Order {
  id: string
  order_number: string
  status: OrderStatus
  customer_name: string
  email: string
  street: string
  zip: string
  city: string
  country: string
  user_id: string | null
  subtotal_cents: number
  shipping_cents: number
  total_cents: number
  cancel_reason: string | null
  cancel_note: string | null
  created_at: string
  /** Bumped by the orders_set_updated_at trigger, so in practice this is when
   *  the status last changed — what the shipped delivery estimate counts from. */
  updated_at: string
  order_items: OrderItem[]
}

export type UserRole = 'customer' | 'admin'

export interface Profile {
  id: string
  email: string
  role: UserRole
  created_at: string
}
