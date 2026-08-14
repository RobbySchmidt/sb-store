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
  subtotal_cents: number
  shipping_cents: number
  total_cents: number
  created_at: string
  order_items: OrderItem[]
}
