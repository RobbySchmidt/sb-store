/**
 * For /login and /register: send an already-signed-in person to where their
 * role belongs, before the page renders.
 *
 * Doing this in the page's onMounted instead would paint the empty form for a
 * frame on a hard navigation, because onMounted only runs after hydration.
 * Route middleware runs during route resolution, ahead of paint.
 */
export default defineNuxtRouteMiddleware(async () => {
  const user = useSupabaseUser()
  if (!user.value) return

  const { profile, refresh, landingPath } = useProfile()
  // `sub`, not `id` — useSupabaseUser() returns JWT claims, not a user row
  if (profile.value?.id !== user.value.sub) await refresh()

  return navigateTo(landingPath.value)
})
