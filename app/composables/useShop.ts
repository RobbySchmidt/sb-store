import type { EoCategory, EoOrder, EoOrderItem, EoProduct } from '~~/shared/types/directus'
import type { AssetOptions } from '~~/shared/utils/assetUrl'

/** Accessories show as GEAR in badges, per the design */
export function badgeLabel(categorySlug?: string | null): string {
  if (!categorySlug) return ''
  return categorySlug === 'accessories' ? 'GEAR' : categorySlug.toUpperCase()
}

/**
 * One product as /api/catalog returns it: `category` always expanded and
 * `stock_available` always computed. EoProduct has to allow both the raw id and
 * the expansion, which the route's inferred type inherits — stating the shape
 * here is what keeps `p.category.slug` out of a union at every call site.
 */
export interface CatalogProduct extends Omit<EoProduct, 'category' | 'stock_available'> {
  category: Pick<EoCategory, 'id' | 'name' | 'slug'>
  stock_available: number
}

export interface CatalogResponse {
  categories: EoCategory[]
  products: CatalogProduct[]
}

/** Catalog: categories + active products with derived availability, fetched once */
export function useCatalog() {
  return useFetch<CatalogResponse>('/api/catalog', { key: 'catalog' })
}

/**
 * assetUrl() bound to the configured Directus base, so a component only has to
 * name the file id and the size it actually paints. Returns null for a missing
 * file, which keeps every image behind its existing `v-if`.
 */
/** Order-line / cart-row thumbnail: ~46px painted, asked for at 2× for retina. */
export const THUMB: AssetOptions = { width: 92, height: 92, fit: 'cover', format: 'webp' }

export function useAssetUrl() {
  const base = useRuntimeConfig().public.directusUrl
  return (id: string | null | undefined, opts: AssetOptions = {}) => assetUrl(base, id, opts)
}

/**
 * An order line as /api/account/orders and /api/admin/orders return it: the
 * `product` relation is expanded to what the thumbnail and the link need, and
 * is null once the product is deleted.
 */
export type ExpandedOrderItem = Omit<EoOrderItem, 'product'> & {
  product: Pick<EoProduct, 'id' | 'slug' | 'image'> | null
}
export type ExpandedOrder = Omit<EoOrder, 'items'> & { items: ExpandedOrderItem[] }
