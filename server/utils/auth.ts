import type { H3Event } from 'h3'
import type { SessionUser } from '../../shared/types/directus'

/**
 * The only authorisation gate in the app.
 *
 * Directus issues a short-lived access token and a rotating refresh token; both
 * are kept in httpOnly cookies so the browser never holds a bearer token. The
 * client-side profile decides what to *render*, never what is *allowed*.
 */

const AT = 'eo_at' // access token
const RT = 'eo_rt' // refresh token

interface DirectusTokens { access_token: string, refresh_token: string, expires: number }

export function setSessionCookies(event: H3Event, t: DirectusTokens) {
  const secure = !import.meta.dev
  setCookie(event, AT, t.access_token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(t.expires / 1000),
  })
  setCookie(event, RT, t.refresh_token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
}

export function clearSessionCookies(event: H3Event) {
  deleteCookie(event, AT, { path: '/' })
  deleteCookie(event, RT, { path: '/' })
}

export function refreshTokenCookie(event: H3Event) {
  return getCookie(event, RT)
}

/**
 * The user behind one access token.
 *
 * Exported because login and register must answer with the person they just
 * signed in, and currentUser() cannot help there: setCookie writes a *response*
 * header while getCookie reads the *request*, so within the same request the
 * cookie just set is still invisible. Those routes hand the fresh access token
 * straight to this instead.
 */
export async function userForToken(token: string): Promise<SessionUser | null> {
  try {
    const [me, globals] = await Promise.all([
      $fetch<{ data: { id: string, email: string | null } }>(
        `${directusUrl()}/users/me?fields=id,email`,
        { headers: { Authorization: `Bearer ${token}` } }),
      $fetch<{ data: { admin_access: boolean } }>(
        `${directusUrl()}/policies/me/globals`,
        { headers: { Authorization: `Bearer ${token}` } }),
    ])
    return { id: me.data.id, email: me.data.email ?? null, isAdmin: !!globals.data.admin_access }
  } catch {
    return null
  }
}

/**
 * The signed-in user, or null. Never throws — for routes where a session is
 * optional (guest checkout).
 *
 * Directus rotates refresh tokens on use, so this only refreshes when the
 * access token is actually gone, and treats a failed refresh as "signed out"
 * rather than as an error.
 */
export async function currentUser(event: H3Event): Promise<SessionUser | null> {
  const access = getCookie(event, AT)
  if (access) {
    const user = await userForToken(access)
    if (user) return user
  }

  const refresh = getCookie(event, RT)
  if (!refresh) return null

  try {
    const res = await $fetch<{ data: DirectusTokens }>(`${directusUrl()}/auth/refresh`, {
      method: 'POST',
      body: { refresh_token: refresh, mode: 'json' },
    })
    setSessionCookies(event, res.data)
    return await userForToken(res.data.access_token)
  } catch {
    clearSessionCookies(event)
    return null
  }
}

/** Any signed-in user, or 401. */
export async function requireUser(event: H3Event): Promise<SessionUser> {
  const user = await currentUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Not signed in' })
  return user
}

/**
 * A signed-in admin, or 401/403. Any Directus user with admin_access counts,
 * which includes every Administrator on this shared instance.
 */
export async function requireAdmin(event: H3Event): Promise<SessionUser> {
  const user = await requireUser(event)
  if (!user.isAdmin) throw createError({ statusCode: 403, statusMessage: 'Admins only' })
  return user
}
