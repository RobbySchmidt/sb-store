import type { Category, Product } from '~/types/shop'

/** Accessories show as GEAR in badges, per the design */
export function badgeLabel(categorySlug?: string | null): string {
  if (!categorySlug) return ''
  return categorySlug === 'accessories' ? 'GEAR' : categorySlug.toUpperCase()
}

/** Catalog: categories + active products, fetched once, shared via useAsyncData */
export function useCatalog() {
  const supabase = useSupabaseClient()
  return useAsyncData('catalog', async () => {
    const [cats, prods] = await Promise.all([
      supabase.from('categories').select('*').order('sort_order'),
      supabase.from('products').select('*, categories(name, slug)').order('created_at'),
    ])
    if (cats.error) throw cats.error
    if (prods.error) throw prods.error
    return {
      categories: (cats.data ?? []) as Category[],
      products: (prods.data ?? []) as Product[],
    }
  })
}
