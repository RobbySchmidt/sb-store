export default defineNuxtRouteMiddleware(async () => {
  const { profile, isAdmin, refresh } = useProfile()
  // middleware can run before profile.client.ts on a hard load
  if (!profile.value) await refresh()
  // Non-admins — signed out or merely a customer — are sent to the storefront
  // rather than /login, so the dashboard's existence is not advertised.
  if (!isAdmin.value) return navigateTo('/')
})
