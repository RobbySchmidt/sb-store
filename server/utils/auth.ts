import type { H3Event } from 'h3'
import type { JwtPayload } from '@supabase/supabase-js'
import { serverSupabaseUser } from '#supabase/server'

/**
 * A signed-in person, normalised.
 *
 * serverSupabaseUser() hands back the verified JWT *claims*, not a row from
 * auth.users. Two traps live in that payload:
 *   - the user id is `sub`, not `id`
 *   - `role` is the Postgres role ('authenticated'), never our app role,
 *     which lives in public.profiles
 * JwtPayload also carries an index signature, so `claims.id` type-checks as
 * `any` and is undefined at runtime. Mapping to this narrow shape here means
 * no caller can reach for the wrong field.
 */
export interface SessionUser {
  id: string
  email: string | null
}

/**
 * The signed-in user, or null. Never throws — for routes where a
 * session is optional (guest checkout).
 */
export async function currentUser(event: H3Event): Promise<SessionUser | null> {
  let claims: JwtPayload | null = null
  try {
    claims = await serverSupabaseUser(event)
  } catch {
    return null
  }
  if (!claims?.sub) return null
  return { id: claims.sub, email: claims.email ?? null }
}

/** Any signed-in user, or 401. */
export async function requireUser(event: H3Event): Promise<SessionUser> {
  const user = await currentUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Not signed in' })
  return user
}

/**
 * A signed-in admin, or 401/403.
 * This is the real gate — the client-side role in useProfile() is
 * only ever used to decide what to render.
 */
export async function requireAdmin(event: H3Event): Promise<SessionUser> {
  const user = await requireUser(event)
  const { data, error } = await supabaseAdmin()
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (error || data?.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Admins only' })
  }
  return user
}
