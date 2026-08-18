import { createUser, readRoles } from '@directus/sdk'

/**
 * Creates the account with the "Ember & Oak Customer" role via the admin token.
 *
 * Deliberately NOT Directus's built-in /users/register: public_registration_role
 * is a single global setting, and another project on this shared instance
 * depends on it.
 */
export default defineEventHandler(async (event) => {
  const { email, password } = await readBody<{ email?: string, password?: string }>(event)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid email address' })
  }
  if (!password || password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters' })
  }

  const roles = await directus().request(readRoles({
    filter: { name: { _eq: 'Ember & Oak Customer' } },
    fields: ['id'],
    limit: 1,
  }))
  if (!roles.length) throw createError({ statusCode: 500, statusMessage: 'Customer role missing — run yarn directus:setup' })

  try {
    await directus().request(createUser({ email, password, role: roles[0]!.id, status: 'active' }))
  } catch (e: any) {
    const msg = String(e?.errors?.[0]?.message ?? e?.message ?? '')
    if (/unique|already/i.test(msg)) {
      throw createError({ statusCode: 409, statusMessage: 'An account with that email already exists' })
    }
    throw createError({ statusCode: 500, statusMessage: 'Could not create the account' })
  }

  const res = await $fetch<{ data: { access_token: string, refresh_token: string, expires: number } }>(
    `${directusUrl()}/auth/login`, { method: 'POST', body: { email, password, mode: 'json' } })
  setSessionCookies(event, res.data)
  return await userForToken(res.data.access_token)
})
