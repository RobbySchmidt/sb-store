import { createDirectus, rest, staticToken } from '@directus/sdk'
import type { Schema } from '../../shared/types/directus'

let client: ReturnType<typeof build> | null = null

function build() {
  const url = process.env.DIRECTUS_URL
  const token = process.env.DIRECTUS_API_TOKEN
  if (!url || !token) throw new Error('DIRECTUS_URL / DIRECTUS_API_TOKEN missing in env')
  return createDirectus<Schema>(url).with(staticToken(token)).with(rest())
}

/** Admin client on the static token — full access. Server-side only. */
export function directus() {
  if (!client) client = build()
  return client
}

/** Base URL for building /assets and /auth URLs. */
export function directusUrl(): string {
  const url = process.env.DIRECTUS_URL
  if (!url) throw new Error('DIRECTUS_URL missing in env')
  return url.replace(/\/$/, '')
}
