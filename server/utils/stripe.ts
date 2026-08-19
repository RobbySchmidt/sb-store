import Stripe from 'stripe'

let client: Stripe | null = null

/**
 * The Stripe wire API version, pinned deliberately.
 *
 * The SDK already sends an explicit Stripe-Version header — it falls back to a
 * constant baked into the installed package. Pinning here changes nothing about
 * today's behaviour; it changes what happens on `yarn upgrade stripe`. Without
 * it, a version bump silently moves the wire protocol under us with no visible
 * diff, and nothing in this project typechecks on build to catch the fallout.
 * With it, the bump is a line someone has to write on purpose.
 *
 * Keep this equal to the SDK's own default (stripe/cjs/apiVersion.js) and move
 * both together — the SDK's types describe that version.
 */
const API_VERSION = '2026-07-29.dahlia'

/**
 * Stripe client on the secret key — server-side only, test mode.
 *
 * Built lazily and cached, exactly like directus(): env is read on first use
 * rather than at import time, so a missing key fails the request that needed
 * it instead of the whole server boot.
 */
export function stripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY missing in env')
    client = new Stripe(key, { apiVersion: API_VERSION })
  }
  return client
}

/** Absolute base for Stripe's success and cancel URLs. Stripe rejects relative ones. */
export function siteUrl(): string {
  const url = process.env.SITE_URL
  if (!url) throw new Error('SITE_URL missing in env')
  return url.replace(/\/$/, '')
}
