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
test('chat sends emoji and safe links, edits and deletes own messages without unsafe HTML', async ({
  page,
}) => {
  await page.goto('./#/chatt')
  await expect(page.getByLabel('Meddelande', { exact: true })).toBeEnabled()
  await page
    .getByLabel('Meddelande', { exact: true })
    .fill('Hej 👋 <img src=x onerror=alert(1)> https://example.com')
  await page.getByRole('button', { name: 'Skicka meddelande' }).click()
  await expect(page.locator('.chat-message:not(.pending-message)')).toHaveCount(
    1,
  )
  await expect(page.locator('.chat-message')).toHaveClass(/is-own/)
  await expect(page.locator('.message-body')).toContainText(
    '<img src=x onerror=alert(1)>',
  )
  expect(await page.locator('.message-body img').count()).toBe(0)
  await expect(page.locator('.message-body a')).toHaveAttribute(
    'href',
    'https://example.com/',
  )
  await page.getByRole('button', { name: /Redigera meddelande/ }).click()
  await page.getByLabel('Ny meddelandetext').fill('Ändrat 😊')
  await page.getByRole('button', { name: 'Spara ändring' }).click()
  await expect(page.locator('.message-body')).toHaveText('Ändrat 😊')
  await expect(page.locator('.message-meta')).toContainText('Redigerat')
  await page.getByRole('button', { name: /Radera meddelande/ }).click()
  await expect(page.getByRole('dialog')).toContainText(
    'Meddelandets text tas bort',
  )
  await page.getByRole('button', { name: 'Ja, radera' }).click()
  await expect(page.locator('.chat-message')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.chat-message')).toHaveCount(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.setViewportSize({ width: 390, height: 420 })
  await page.getByLabel('Meddelande', { exact: true }).focus()
  const box = await page.getByLabel('Meddelande', { exact: true }).boundingBox()
  expect(box!.y + box!.height).toBeLessThanOrEqual(420)
})
test('home preview, unread badge, own read state and notification preference', async ({
  page,
}) => {
  await calendarRpc(
    db,
    'chat_send',
    { message_body: 'Hej från Sally', request_id: crypto.randomUUID() },
    sallyUser,
  )
  await page.goto('./')
  await expect(
    page.getByLabel('Vardagen just nu').getByRole('link', { name: /Sally/ }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('navigation', { name: 'Huvudnavigation' })
      .getByLabel('1 olästa meddelanden'),
  ).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Huvudnavigation' })
    .getByRole('link', { name: /Chatt/ })
    .click()
  await expect(page.locator('.chat-message')).toHaveCount(1)
  await expect(page.locator('.chat-message')).not.toHaveClass(/is-own/)
  expect(
    await page.getByRole('button', { name: /Redigera meddelande/ }).count(),
  ).toBe(0)
  await expect(
    page
      .getByRole('navigation', { name: 'Huvudnavigation' })
      .getByLabel('1 olästa meddelanden'),
  ).not.toBeVisible()
  await expect(page.getByLabel('Notiser för nya chattmeddelanden')).toHaveCount(
    0,
  )
})
test('pagination loads older history without duplicates and mobile Enter inserts a newline', async ({
  page,
}) => {
  for (let i = 0; i < 45; i++)
    await calendarRpc(
      db,
      'chat_send',
      { message_body: 'Historik ' + i, request_id: crypto.randomUUID() },
      sallyUser,
    )
  await page.goto('./#/chatt')
  await expect(page.locator('.chat-message')).toHaveCount(40)
  await page.getByRole('button', { name: 'Ladda äldre meddelanden' }).click()
  await expect(page.locator('.chat-message')).toHaveCount(45)
  await expect(
    page.getByRole('button', { name: 'Ladda äldre meddelanden' }),
  ).not.toBeVisible()
  await page.getByLabel('Meddelande', { exact: true }).fill('Rad ett')
  await page.getByLabel('Meddelande', { exact: true }).press('Enter')
  await expect(page.getByLabel('Meddelande', { exact: true })).toHaveValue(
    'Rad ett\n',
  )
  await expect(page.locator('.chat-message')).toHaveCount(45)
  await page.evaluate(() => {
    const el = document.querySelector('.chat-timeline')!
    el.scrollTop = 0
    el.dispatchEvent(new Event('scroll'))
  })
  await calendarRpc(
    db,
    'chat_send',
    {
      message_body: 'Nytt medan du läser äldre',
      request_id: crypto.randomUUID(),
    },
    sallyUser,
  )
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(
    page.getByRole('button', { name: 'Till senaste meddelandet' }),
  ).toBeVisible()
  expect(
    await page.locator('.chat-timeline').evaluate((el) => el.scrollTop),
  ).toBeLessThan(100)
  await page.getByRole('button', { name: 'Till senaste meddelandet' }).click()
  await expect(
    page.getByText('Nytt medan du läser äldre', { exact: true }),
  ).toBeVisible()
})
test('failed send retries with same request ID without duplicates', async ({
  page,
}) => {
  let first = true
  const requests: string[] = []
  await page.route('**/rpc/chat_send', async (route) => {
    const body = route.request().postDataJSON()
    requests.push(body.request_id)
    if (first) {
      first = false
      await calendarRpc(db, 'chat_send', body)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Svar förlorat' }),
      })
    } else await route.fallback()
  })
  await page.goto('./#/chatt')
  await expect(page.getByLabel('Meddelande', { exact: true })).toBeEnabled()
  await page.getByLabel('Meddelande', { exact: true }).fill('Återförsök')
  await page.getByRole('button', { name: 'Skicka meddelande' }).click()
  await expect(
    page.getByRole('button', { name: 'Försök skicka igen' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Försök skicka igen' }).click()
  await expect(page.locator('.pending-message')).toHaveCount(0)
  await expect(page.locator('.chat-message')).toHaveCount(1)
  expect(new Set(requests).size).toBe(1)
})
test('desktop Enter sends and Shift Enter keeps a line break', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    hasTouch: false,
    isMobile: false,
    serviceWorkers: 'block',
  })
  await api(context)
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:4174/familjen/#/chatt')
  await expect(page.getByLabel('Meddelande', { exact: true })).toBeEnabled()
  await page.getByLabel('Meddelande', { exact: true }).fill('Första raden')
  await page.getByLabel('Meddelande', { exact: true }).press('Shift+Enter')
  await expect(page.getByLabel('Meddelande', { exact: true })).toHaveValue(
    'Första raden\n',
  )
  await page.getByLabel('Meddelande', { exact: true }).press('Enter')
  await expect(page.locator('.chat-message')).toHaveCount(1)
  await context.close()
})
