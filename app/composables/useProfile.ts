import type { Profile, UserRole } from '~/types/shop'

/**
 * The signed-in person's own profile row, read through the RLS
 * "own profile is readable" policy — the same way useShop() reads the
 * public catalog.
 *
 * This is for UI only: which menu items to render, where to send someone
 * after login. It is NEVER the gate. requireAdmin() in server/utils/auth.ts
 * is the real protection.
 */
export function useProfile() {
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()
  const profile = useState<Profile | null>('profile', () => null)

  async function fetchProfile(id: string): Promise<Profile | null> {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, role, created_at')
      .eq('id', id)
      .single()
    return (data as Profile | null) ?? null
  }

  /** Sync the cache with whoever is signed in right now.
   *
   * useSupabaseUser() hands back the verified JWT *claims*, not a row from
   * auth.users — the same trap as serverSupabaseUser() on the server side
   * (see server/utils/auth.ts). The user id is `sub`, not `id`. The claims
   * object also carries an index signature, so `user.value.id` type-checks
   * as `any` and is undefined at runtime.
   */
  async function refresh(): Promise<Profile | null> {
    profile.value = user.value ? await fetchProfile(user.value.sub) : null
    return profile.value
  }

  /**
   * Load for an explicit id. Used immediately after signIn/signUp, when the
   * reactive user ref has not caught up with the new session yet.
   */
  async function loadFor(id: string): Promise<Profile | null> {
    profile.value = await fetchProfile(id)
    return profile.value
  }

  const role = computed<UserRole | null>(() => profile.value?.role ?? null)
  const isAdmin = computed(() => role.value === 'admin')
  /** Where this person belongs after signing in. */
  const landingPath = computed(() => (isAdmin.value ? '/admin' : '/account'))

  return { profile, role, isAdmin, landingPath, refresh, loadFor }
}
