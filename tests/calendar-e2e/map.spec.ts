import { test, expect, type BrowserContext } from '@playwright/test'
import { calendarDatabase, calendarRpc, testUser } from '../support/database'
import type { PGlite } from '@electric-sql/pglite'
let db: PGlite
const sallyUser = '00000000-0000-0000-0000-000000000012'
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
async function api(context: BrowserContext, user = testUser) {
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
test.beforeEach(async ({ context }) => {
  db = await calendarDatabase()
  await db.exec(
    `insert into auth.users values ('${sallyUser}'); update public.profiles set auth_user_id='${sallyUser}' where profile_key='sally'`,
  )
  await api(context)
})
test.afterEach(async () => db.close())

async function tiles(context: BrowserContext) {
  await context.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/B9sAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  )
}
test('family map shows three ages, person markers, exact times and four unchanged main tabs', async ({
  page,
  context,
}) => {
  await tiles(context)
  const users = await db.query<{ id: string; profile_key: string }>(
    'select id,profile_key from public.profiles',
  )
  for (const [i, p] of users.rows.entries())
    await db.query(
      'insert into public.positions(profile_id,family_id,latitude,longitude,accuracy,reported_at) select id,family_id,$2,$3,15,$4 from public.profiles where id=$1',
      [
        p.id,
        59.86 + i * 0.001,
        17.64 + i * 0.001,
        new Date(Date.now() - [0, 300000, 7200000][i]!).toISOString(),
      ],
    )
  await page.goto('./#/karta')
  await expect(
    page.getByRole('heading', { name: 'Familjekarta', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.family-marker')).toHaveCount(3)
  await expect(page.locator('.map-person-list')).toContainText(
    'Nyligen uppdaterad',
  )
  await expect(page.locator('.map-person-list')).toContainText('Äldre position')
  await expect(page.locator('.map-person-list')).toContainText(
    'Inaktuell position',
  )
  await expect(
    page.getByRole('navigation', { name: 'Huvudnavigation' }).getByRole('link'),
  ).toHaveCount(4)
  await expect(page.locator('.map-person-list')).toContainText('GPS')
  await expect(page.locator('.leaflet-control-attribution')).toContainText(
    'OpenStreetMap',
  )
  await page.getByRole('button', { name: 'Visa hela familjen' }).click()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  expect(
    await page
      .getByRole('button', { name: /Stäng av GPS|Pausa plats/ })
      .count(),
  ).toBe(0)
  await page.screenshot({
    path: test.info().outputPath('family-map.png'),
    fullPage: true,
  })
  await page.evaluate(() => {
    const original = Date.now
    Date.now = () => original() + 20 * 60000
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.locator('.position-age.stale')).toHaveCount(3)
})
test('foreground GPS reports own position and help requires confirmation then links from chat', async ({
  page,
  context,
}) => {
  await tiles(context)
  await context.addInitScript(() => {
    const p = () => ({
      coords: { latitude: 59.86, longitude: 17.64, accuracy: 12 },
      timestamp: Date.now(),
    })
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: async () => ({ state: 'granted', onchange: null }) },
    })
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: (success: PositionCallback) => {
          setTimeout(() => success(p() as GeolocationPosition), 0)
          return 1
        },
        clearWatch: () => {},
        getCurrentPosition: (success: PositionCallback) =>
          setTimeout(() => success(p() as GeolocationPosition), 0),
      },
    })
  })
  await page.goto('./#/karta')
  await expect(page.locator('.family-marker')).toHaveCount(1)
  await expect(page.locator('.map-person-list')).toContainText('Neo · Du')
  await page.getByRole('button', { name: 'Be familjen om hjälp' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Nyligen uppdaterad')
  expect(
    (await db.query('select * from public.chat_messages')).rows,
  ).toHaveLength(0)
  await dialog
    .getByRole('button', { name: 'Ja, skicka hjälpmeddelande' })
    .click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.help-result')).toContainText(
    'Ingen ansluten notisenhet',
  )
  await page
    .getByRole('navigation', { name: 'Huvudnavigation' })
    .getByRole('link', { name: 'Chatt', exact: true })
    .click()
  await expect(page.locator('.chat-message')).toContainText('Jag behöver hjälp')
  await expect(page.locator('.help-priority')).toContainText('hög prioritet')
  await page.getByRole('link', { name: 'Visa hjälpposition' }).click()
  await expect(page).toHaveURL(/#\/karta\?help=/)
  await expect(page.getByText(/Hjälpposition från/)).toBeVisible()
})
test('denied GPS allows an explicitly confirmed help message without pretending a location is known', async ({
  page,
  context,
}) => {
  await tiles(context)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: async () => ({ state: 'denied', onchange: null }) },
    })
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: () => 1,
        clearWatch: () => {},
        getCurrentPosition: (
          _s: PositionCallback,
          error: PositionErrorCallback,
        ) => error({ code: 1, message: 'denied' } as GeolocationPositionError),
      },
    })
  })
  await page.goto('./#/karta')
  await expect(page.getByText(/Platsbehörighet saknas/)).toBeVisible()
  await page.getByRole('button', { name: 'Be familjen om hjälp' }).click()
  await expect(page.getByRole('dialog')).toContainText('GPS-position saknas')
  await page.getByRole('button', { name: 'Ja, skicka hjälpmeddelande' }).click()
  await expect(page.locator('.help-result')).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Huvudnavigation' })
    .getByRole('link', { name: 'Chatt', exact: true })
    .click()
  await expect(page.locator('.message-body')).toContainText(
    'Ingen GPS-position',
  )
})

test('visible map recovers a missed realtime event without reloading the page or changing GPS time', async ({
  page,
  context,
}) => {
  await tiles(context)
  let completedSnapshots = 0
  page.on('response', (response) => {
    if (response.url().endsWith('/rpc/map_snapshot') && response.ok())
      completedSnapshots++
  })
  await page.clock.install()
  await page.goto('./#/karta')
  await expect(
    page.getByRole('heading', { name: 'Familjekarta', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.family-marker')).toHaveCount(0)
  await expect.poll(() => completedSnapshots).toBeGreaterThanOrEqual(2)
  const beforeSnapshots = completedSnapshots
  const timestamp = new Date(Date.now() - 300000).toISOString()
  await db.query(
    'insert into public.positions(profile_id,family_id,latitude,longitude,accuracy,reported_at) select id,family_id,59.86,17.64,15,$1 from public.profiles where profile_key=$2',
    [timestamp, 'sally'],
  )
  // The test API has no WebSocket server, so no realtime event reaches this page.
  await page.clock.runFor(31000)
  await expect.poll(() => completedSnapshots).toBeGreaterThan(beforeSnapshots)
  await expect(page.locator('.family-marker')).toHaveCount(1)
  await expect(
    page.locator('.map-person').filter({ hasText: 'Sally' }),
  ).toContainText('Äldre position')
  const { rows } = await db.query<{ reported_at: Date }>(
    'select reported_at from public.positions',
  )
  expect(new Date(rows[0]!.reported_at).toISOString()).toBe(timestamp)
})
