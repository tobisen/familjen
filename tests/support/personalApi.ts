import type { BrowserContext } from '@playwright/test'
import type { PGlite } from '@electric-sql/pglite'
import { calendarRpc, testUser } from './database'
function session(user: string) {
  const claims = {
    sub: user,
    role: 'authenticated',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  }
  const access_token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test_signature`
  return {
    access_token,
    refresh_token: 'test_refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: claims.exp,
    user: {
      id: user,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'fixture@example.invalid',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    },
  }
}
export async function personalApi(
  context: BrowserContext,
  db: PGlite,
  user = testUser,
) {
  const stored = session(user)
  await context.addInitScript(
    (value) =>
      localStorage.setItem('familjen.supabase.session', JSON.stringify(value)),
    stored,
  )
  await context.route('https://familjen.test.invalid/auth/v1/user', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stored.user),
    }),
  )
  await context.route(
    'https://familjen.test.invalid/rest/v1/rpc/**',
    async (route) => {
      const req = route.request()
      const name = new URL(req.url()).pathname.split('/').at(-1)!
      if (req.method() === 'OPTIONS') {
        await route.fulfill({
          status: 200,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
          },
        })
        return
      }
      try {
        const result = await calendarRpc(
          db,
          name,
          req.postDataJSON() ?? {},
          user,
        )
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(result),
        })
      } catch (e) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            message: e instanceof Error ? e.message : 'RPC error',
            code: 'P0001',
          }),
        })
      }
    },
  )
}
