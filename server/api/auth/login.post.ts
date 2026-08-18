export default defineEventHandler(async (event) => {
  const { email, password } = await readBody<{ email?: string, password?: string }>(event)
  if (!email || !password) throw createError({ statusCode: 400, statusMessage: 'Email and password required' })

  let res: { data: { access_token: string, refresh_token: string, expires: number } }
  try {
    res = await $fetch(`${directusUrl()}/auth/login`, {
      method: 'POST',
      body: { email, password, mode: 'json' },
    })
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Wrong email or password' })
  }

  setSessionCookies(event, res.data)
  return await userForToken(res.data.access_token)
})
