import type { SessionUser } from '~~/shared/types/directus'

/**
 * The signed-in person. For UI only: which menu items to render, where to send
 * someone after login. It is NEVER the gate — requireAdmin() in
 * server/utils/auth.ts is the real protection.
 */
export function useProfile() {
  const profile = useState<SessionUser | null>('profile', () => null)

  /**
   * useRequestFetch(), not plain $fetch: the session lives in httpOnly cookies
   * on the *incoming* request, and during SSR $fetch sends none of them. With
   * $fetch every hard load looks signed out to the middleware, so a signed-in
   * admin opening /admin directly gets bounced to /. On the client this is
   * $fetch anyway. (Verified against a probe route, not assumed.)
   */
  async function refresh(): Promise<SessionUser | null> {
    const request = useRequestFetch()
    profile.value = await request<SessionUser | null>('/api/auth/me')
    return profile.value
  }

  async function signOut() {
    await $fetch('/api/auth/logout', { method: 'POST' })
    profile.value = null
    await navigateTo('/')
  }

  const isAdmin = computed(() => profile.value?.isAdmin === true)
  const role = computed(() => (profile.value ? (isAdmin.value ? 'admin' : 'customer') : null))
  /** Where this person belongs after signing in. */
  const landingPath = computed(() => (isAdmin.value ? '/admin' : '/account'))

  return { profile, role, isAdmin, landingPath, refresh, signOut }
}
