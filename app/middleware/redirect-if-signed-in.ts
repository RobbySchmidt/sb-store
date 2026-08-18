/**
 * For /login and /register: send an already-signed-in person to where their
 * role belongs, before the page renders.
 *
 * Doing this in the page's onMounted instead would paint the empty form for a
 * frame on a hard navigation, because onMounted only runs after hydration.
 * Route middleware runs during route resolution, ahead of paint.
 */
export default defineNuxtRouteMiddleware(async () => {
  const { profile, landingPath, refresh } = useProfile()
  // middleware can run before profile.client.ts on a hard load
  if (!profile.value) await refresh()
  if (profile.value) return navigateTo(landingPath.value)
})
