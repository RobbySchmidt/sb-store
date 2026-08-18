/**
 * The cart's own line shape. Everything else the shop renders comes straight
 * from Directus and is typed in shared/types/directus.ts.
 *
 * Name and price are copied in on add, so a cart survives a rename or reprice
 * without a round trip; the id is what checkout actually prices against.
 */
export interface CartItem {
  productId: string
  slug: string
  name: string
  unitPriceCents: number
  /** directus_files id — build a URL with assetUrl() / useAssetUrl(). */
  image: string | null
  qty: number
}
