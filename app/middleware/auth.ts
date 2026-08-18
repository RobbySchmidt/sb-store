export default defineNuxtRouteMiddleware(async () => {
  const { profile, refresh } = useProfile()
  // middleware can run before profile.client.ts on a hard load
  if (!profile.value) await refresh()
  if (!profile.value) return navigateTo('/login')
})
