export default defineNuxtRouteMiddleware(async () => {
  const user = useSupabaseUser()
  const { profile, refresh, isAdmin } = useProfile()

  // Non-admins — signed out or merely a customer — are sent to the storefront
  // rather than /login, so the dashboard's existence is not advertised.
  if (!user.value) return navigateTo('/')

  // `sub`, not `id` — useSupabaseUser() returns JWT claims, not a user row
  if (profile.value?.id !== user.value.sub) await refresh()
  if (!isAdmin.value) return navigateTo('/')
})
