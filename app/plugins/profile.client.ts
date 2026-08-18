/**
 * Fills the cached profile once on a hard load, so the header knows the role on
 * every page — including pages with no middleware.
 */
export default defineNuxtPlugin(async () => {
  const { profile, refresh } = useProfile()
  if (!profile.value) await refresh()
})
