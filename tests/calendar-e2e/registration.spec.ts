import { test, expect } from '@playwright/test'
import { calendarDatabase, calendarRpc, testUser } from '../support/database'
import type { PGlite } from '@electric-sql/pglite'
let db: PGlite
const jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: testUser, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test_signature`
const user = {
  id: testUser,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'fixture@example.invalid',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
}
test.beforeEach(async ({ context }) => {
  db = await calendarDatabase()
  await context.route('https://familjen.test.invalid/auth/v1/user', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(user),
    }),
  )
  await context.route(
    'https://familjen.test.invalid/rest/v1/rpc/**',
    async (route) => {
      try {
        const result = await calendarRpc(
          db,
          new URL(route.request().url()).pathname.split('/').at(-1)!,
          route.request().postDataJSON() ?? {},
        )
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(result),
        })
      } catch {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Denied' }),
        })
      }
    },
  )
  await context.route(
    'https://familjen.test.invalid/functions/v1/register-device',
    async (route) => {
      const { profile, code } = route.request().postDataJSON()
      if (profile === 'neo' && code === '0123-4567-89AB-CDEF') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            access_token: jwt,
            refresh_token: 'fixture-refresh',
          }),
        })
      } else
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error:
              'Koden är felaktig eller har ersatts med en ny kod. Be om en ny personlig kod.',
          }),
        })
    },
  )
})
test.afterEach(async () => db.close())
test('register by selected profile and code, then restore session and preserve it during recovery', async ({
  page,
}) => {
  await page.goto('./register/')
  await expect(
    page.getByRole('heading', { name: 'Välkommen hem.' }),
  ).toBeVisible()
  await page.getByRole('radio', { name: 'Neo', exact: true }).check()
  await page.getByLabel('Personlig kod').fill('0123-4567-89AB-CDEF')
  await page.getByRole('button', { name: 'Logga in med personlig kod' }).click()
  await expect(
    page.getByRole('heading', { name: 'Kalender', exact: true }),
  ).toBeVisible()
  const before = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('familjen.supabase.session')!)
        .refresh_token,
  )
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Kalender', exact: true }),
  ).toBeVisible()
  await page.goto('./recover/')
  await page.getByRole('button', { name: 'Återställ appens cache' }).click()
  await expect(
    page.getByRole('heading', { name: 'Kalender', exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('familjen.supabase.session')!)
          .refresh_token,
    ),
  ).toBe(before)
})
test('wrong and replaced codes fail without creating a session', async ({
  page,
}) => {
  await page.goto('./register/')
  await page.getByRole('radio', { name: 'Neo', exact: true }).check()
  for (const code of ['WRON-GCOD-E000-0000', 'EXPI-REDC-ODE0-0000']) {
    await page.getByLabel('Personlig kod').fill(code)
    await page
      .getByRole('button', { name: 'Logga in med personlig kod' })
      .click()
    await expect(page.getByRole('alert')).toContainText(
      'felaktig eller har ersatts med en ny kod',
    )
    expect(
      await page.evaluate(() =>
        localStorage.getItem('familjen.supabase.session'),
      ),
    ).toBeNull()
  }
})
test('startup with an expired invalid stored session stays recoverable', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'familjen.supabase.session',
      JSON.stringify({
        access_token: 'invalid',
        refresh_token: 'expired',
        expires_at: 1,
      }),
    ),
  )
  await page.route('**/auth/v1/token**', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'invalid_grant',
        error_description: 'Expired refresh token',
      }),
    }),
  )
  await page.goto('./')
  await expect(
    page.getByRole('heading', { name: 'Välkommen hem.' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Logga in med personlig kod' }),
  ).toBeVisible({ timeout: 20000 })
})

test('the same personal code logs in again after local session storage is lost', async ({
  page,
}) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto('./register/')
    await page.getByRole('radio', { name: 'Neo', exact: true }).check()
    await page.getByLabel('Personlig kod').fill('0123-4567-89AB-CDEF')
    await page
      .getByRole('button', { name: 'Logga in med personlig kod' })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Kalender', exact: true }),
    ).toBeVisible()
    if (attempt === 0)
      await page.evaluate(() =>
        localStorage.removeItem('familjen.supabase.session'),
      )
  }
})
