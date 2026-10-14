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
test('tasks: mobile plus, multiple assignees, priority, filters, edit, completion, home and deletion', async ({
  page,
}) => {
  await page.goto('./#/listor')
  await expect(page.getByRole('button', { name: 'Ny uppgift' })).toBeEnabled()
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('heading', { name: 'Ny uppgift' }),
  ).toBeVisible()
  await dialog
    .getByLabel('Titel', { exact: true })
    .fill('Tvätta träningskläder')
  await dialog.getByLabel('Beskrivning').fill('Färger separat')
  await dialog.getByLabel('Sally', { exact: true }).check()
  expect(await dialog.getByLabel('Neo', { exact: true }).isChecked()).toBe(true)
  await dialog.getByLabel('Deadline', { exact: true }).fill('2026-01-31')
  await dialog.getByLabel('Prioritet', { exact: true }).selectOption('high')
  await dialog.getByRole('button', { name: 'Spara', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  for (const text of [
    'Tvätta träningskläder',
    'Neo, Sally',
    'Förfallen',
    'Hög prioritet',
    'Skapad av Neo',
  ])
    await expect(page.locator('.task-row')).toContainText(text)
  await page.getByRole('button', { name: 'Mina', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Tvätta träningskläder' }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Redigera Tvätta träningskläder' })
    .click()
  dialog = page.getByRole('dialog')
  await expect(page.getByText('Förbered framtida påminnelse')).toHaveCount(0)
  await expect(page.getByLabel('Dagar före deadline')).toHaveCount(0)
  await dialog.getByLabel('Titel', { exact: true }).fill('Tvätta kläder')
  await dialog.getByRole('button', { name: 'Spara', exact: true }).click()
  await page.goto('./')
  await expect(
    page.getByRole('heading', { name: 'Att göra just nu' }),
  ).toBeVisible()
  await expect(page.locator('.home-task-row')).toContainText('Tvätta kläder')
  await page.goto('./#/listor')
  await page.getByRole('button', { name: 'Slutför Tvätta kläder' }).click()
  await expect(
    page.getByRole('heading', { name: 'Tvätta kläder' }),
  ).not.toBeVisible()
  await page.getByRole('button', { name: 'Klara', exact: true }).click()
  await expect(page.locator('.task-row')).toContainText('Klar av Neo')
  await page.getByRole('button', { name: 'Återställ Tvätta kläder' }).click()
  await page.getByRole('button', { name: 'Aktiva', exact: true }).click()
  await page.getByRole('button', { name: 'Redigera Tvätta kläder' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Radera uppgift' })
    .click()
  await expect(page.getByRole('dialog')).toContainText(
    'Vill du radera Tvätta kläder?',
  )
  await page.getByRole('dialog').getByRole('button', { name: 'Avbryt' }).click()
  await expect(
    page.getByRole('dialog').getByLabel('Titel', { exact: true }),
  ).toHaveValue('Tvätta kläder')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Radera uppgift' })
    .click()
  await page.getByRole('button', { name: 'Ja, radera' }).click()
  await expect(
    page.getByRole('heading', { name: 'Tvätta kläder' }),
  ).not.toBeVisible()
})
test('recurring task completes one occurrence and creates next monthly date without duplicate', async ({
  page,
}) => {
  await page.goto('./#/listor')
  await page.getByRole('button', { name: 'Ny uppgift' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Titel', { exact: true }).fill('Månadsstädning')
  await dialog.getByLabel('Deadline', { exact: true }).fill('2026-01-31')
  await dialog.getByLabel('Återkomst', { exact: true }).selectOption('monthly')
  await dialog.getByRole('button', { name: 'Spara', exact: true }).click()
  await page.getByRole('button', { name: 'Slutför Månadsstädning' }).click()
  await expect(page.locator('.task-row')).toContainText('2026-02-28')
  await expect(page.locator('.task-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Alla', exact: true }).click()
  await expect(page.locator('.task-row')).toHaveCount(2)
  await page.reload()
  await expect(page.locator('.task-row')).toHaveCount(1)
})
test('shopping: quick input, buy, undo, history restore, edit, delete and homepage count', async ({
  page,
}) => {
  await page.goto('./#/listor?tab=inkop')
  await expect(
    page.getByRole('button', { name: 'Lägg till vara', exact: true }),
  ).toBeEnabled()
  await page.getByLabel('Varunamn', { exact: true }).fill('Mjölk')
  await page.getByLabel('Antal', { exact: true }).fill('2')
  await page.getByLabel('Enhet (valfri)', { exact: true }).fill('liter')
  await page
    .getByRole('button', { name: 'Lägg till vara', exact: true })
    .click()
  await expect(page.locator('.shopping-row')).toContainText('2 liter')
  await page.goto('./')
  await expect(
    page.getByText('1 varor kvar att köpa', { exact: true }),
  ).toBeVisible()
  await page.goto('./#/listor?tab=inkop')
  await page.getByRole('button', { name: 'Köp Mjölk' }).click()
  await expect(page.locator('.shopping-row')).toHaveCount(0)
  await page.getByRole('button', { name: 'Ångra', exact: true }).click()
  await expect(page.locator('.shopping-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Köp Mjölk' }).click()
  await page.getByRole('button', { name: /Köphistorik/ }).click()
  await expect(page.locator('.purchase-history')).toContainText('Mjölk')
  await page.getByRole('button', { name: 'Återställ Mjölk' }).click()
  await expect(page.locator('.shopping-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Redigera Mjölk' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Varunamn', { exact: true }).fill('Havredryck')
  await dialog.getByLabel('Antal', { exact: true }).fill('3')
  await dialog.getByRole('button', { name: 'Spara', exact: true }).click()
  await expect(page.locator('.shopping-row')).toContainText(
    /Havredryck.*3 liter/s,
  )
  await page.getByRole('button', { name: 'Redigera Havredryck' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Radera vara' })
    .click()
  await page.getByRole('button', { name: 'Ja, radera' }).click()
  await expect(page.locator('.shopping-row')).toHaveCount(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})
test('failed purchase keeps item active and reports the error', async ({
  page,
}) => {
  await calendarRpc(db, 'lists_save', {
    kind: 'shopping',
    payload: { title: 'Testvara', amount: 1, unit: '' },
    request_id: crypto.randomUUID(),
  })
  await page.goto('./#/listor?tab=inkop')
  await expect(page.getByRole('button', { name: 'Köp Testvara' })).toBeEnabled()
  await page.route('**/rpc/lists_set_done', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Tillfälligt serverfel' }),
    }),
  )
  await page.getByRole('button', { name: 'Köp Testvara' }).click()
  await expect(page.getByRole('alert')).toContainText('Tillfälligt serverfel')
  await expect(page.locator('.shopping-row')).toHaveCount(1)
})
