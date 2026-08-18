/**
 * Keeps the cached profile in step with the auth session, so the header
 * knows the role on every page — including pages with no middleware.
 * Mirrors the existing app/plugins/cart.client.ts pattern.
 */
export default defineNuxtPlugin(() => {
  const user = useSupabaseUser()
  const { profile, refresh } = useProfile()

  watch(
    user,
    async (value) => {
      if (!value) {
        profile.value = null
        return
      }
      // value is JWT claims — the id is `sub`, not `id` (see useProfile.ts).
      if (profile.value?.id === value.sub) return
      await refresh()
    },
    { immediate: true },
  )
})
