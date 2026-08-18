export default defineEventHandler(async (event) => {
  const refresh = refreshTokenCookie(event)
  clearSessionCookies(event)
  if (refresh) {
    // Best effort — the cookies are already gone, so the person is signed out
    // regardless of whether Directus accepts this.
    await $fetch(`${directusUrl()}/auth/logout`, {
      method: 'POST',
      body: { refresh_token: refresh, mode: 'json' },
    }).catch(() => {})
  }
  return { ok: true }
})
