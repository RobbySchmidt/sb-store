export interface AssetOptions {
  width?: number
  height?: number
  quality?: number
  format?: 'webp' | 'jpg' | 'png'
  fit?: 'cover' | 'contain' | 'inside' | 'outside'
}

/**
 * URL for a Directus file. Returns null for a missing file so callers can
 * keep using `v-if` rather than rendering a broken image.
 *
 * Transformations are the reason images are stored as file ids rather than
 * absolute URLs: a product card asks for the size it actually paints.
 */
export function assetUrl(
  base: string,
  id: string | null | undefined,
  opts: AssetOptions = {},
): string | null {
  if (!id) return null
  const q = new URLSearchParams()
  if (opts.width) q.set('width', String(opts.width))
  if (opts.height) q.set('height', String(opts.height))
  if (opts.quality) q.set('quality', String(opts.quality))
  if (opts.format) q.set('format', opts.format)
  if (opts.fit) q.set('fit', opts.fit)
  const qs = q.toString()
  return `${base.replace(/\/$/, '')}/assets/${id}${qs ? `?${qs}` : ''}`
}
