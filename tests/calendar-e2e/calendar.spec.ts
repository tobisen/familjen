import { test, expect, type BrowserContext } from '@playwright/test'
import { calendarDatabase, calendarRpc } from '../support/database'
import type { PGlite } from '@electric-sql/pglite'
let db: PGlite
async function api(context: BrowserContext) {
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
        const result = await calendarRpc(db, name, req.postDataJSON() ?? {})
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
  await api(context)
})
test.afterEach(async () => db.close())
test('calendar CRUD with participants, views, filter, persistence and deletion confirmation', async ({
  page,
  context,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'N Neo' }).click()
  await page
    .getByRole('navigation', { name: 'Mobilnavigation' })
    .getByRole('link', { name: 'Kalender' })
    .click()
  await expect(
    page.getByRole('button', { name: 'Ny aktivitet', exact: true }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Neo', { exact: true })).toBeChecked()
  await dialog.getByLabel('Titel', { exact: true }).fill('E2E aktivitet')
  await dialog.getByLabel('Tobias', { exact: true }).check()
  await dialog
    .getByLabel('Beskrivning', { exact: true })
    .fill('Test fixture only')
  await dialog.getByRole('button', { name: 'Spara aktivitet' }).click()
  await expect(dialog).not.toBeVisible()
  const event = page.getByRole('button', { name: /E2E aktivitet,/ }).first()
  await expect(event).toBeVisible()
  await page.screenshot({
    path: test.info().outputPath('calendar-week.png'),
    fullPage: true,
  })
  await event.click()
  await expect(page.getByRole('dialog')).toContainText('Test fixture only')
  await page.getByRole('button', { name: 'Redigera', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByLabel('Titel', { exact: true })
    .fill('E2E ändrad')
  await page.getByRole('button', { name: 'Spara aktivitet' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: 'Månad', exact: true }).click()
  await expect(
    page.getByRole('button', { name: /E2E ändrad,/ }).first(),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Dag', exact: true }).click()
  await expect(
    page.getByRole('button', { name: /E2E ändrad,/ }).first(),
  ).toBeVisible()
  await page.getByRole('checkbox', { name: 'Sally', exact: true }).check()
  await expect(page.getByRole('button', { name: /E2E ändrad,/ })).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Sally', exact: true }).uncheck()
  await page.reload()
  await expect(
    page.getByRole('button', { name: /E2E ändrad,/ }).first(),
  ).toBeVisible()
  // Separate browser page/context sees the same persisted SQL data after loading.
  const other = await context.browser()!.newContext({
    ...{ viewport: { width: 390, height: 844 } },
    serviceWorkers: 'block',
  })
  await api(other)
  const second = await other.newPage()
  await second.goto('http://127.0.0.1:4174/familjen/')
  await second.getByRole('button', { name: 'S Sally' }).click()
  await second
    .getByRole('navigation', { name: 'Mobilnavigation' })
    .getByRole('link', { name: 'Kalender' })
    .click()
  await expect(
    second.getByRole('button', { name: /E2E ändrad,/ }).first(),
  ).toBeVisible()
  await other.close()
  await page
    .getByRole('button', { name: /E2E ändrad,/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Radera', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText(
    'Vill du radera aktiviteten?',
  )
  await page.getByRole('button', { name: 'Behåll', exact: true }).click()
  await page.getByRole('button', { name: 'Radera', exact: true }).click()
  await page.getByRole('button', { name: 'Ja, radera', exact: true }).click()
  await expect(page.getByRole('button', { name: /E2E ändrad,/ })).toHaveCount(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})
test('school preview, publication confirmation and idempotent import', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'S Sally' }).click()
  await page
    .getByRole('navigation', { name: 'Mobilnavigation' })
    .getByRole('link', { name: 'Kalender' })
    .click()
  await page.getByRole('button', { name: 'Importera schema' }).click()
  const data = {
    student_id: 'sally',
    source: 'E2E fixture',
    term_start: '2026-01-01',
    term_end: null,
    exception_dates: [],
    lessons: [
      {
        external_id: 'fixture',
        weekday: 1,
        starts_at: '10:00',
        ends_at: '11:00',
        subject: 'Fixture lesson',
        room: null,
      },
    ],
  }
  await page.getByLabel('JSON-fil').setInputFiles({
    name: 'fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  })
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Fixture lesson')
  await expect(
    dialog.getByRole('button', { name: 'Importera schema', exact: true }),
  ).toBeDisabled()
  await dialog.getByRole('checkbox').check()
  await dialog
    .getByRole('button', { name: 'Importera schema', exact: true })
    .click()
  await expect(dialog.getByRole('status')).toContainText(
    '1 lektioner importerades',
  )
  await expect(dialog).toContainText('1 uppdateras')
  await dialog.getByRole('checkbox').check()
  await dialog
    .getByRole('button', { name: 'Importera schema', exact: true })
    .click()
  await expect(dialog.getByRole('status')).toContainText(
    '1 lektioner importerades',
  )
  const rows = await db.query('select * from public.open_school_lessons')
  expect(rows.rows).toHaveLength(1)
})

test('empty time slot, heldag recurrence and a single skipped occurrence', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'T Tobias' }).click()
  await page
    .getByRole('navigation', { name: 'Mobilnavigation' })
    .getByRole('link', { name: 'Kalender' })
    .click()
  const slot = page
    .getByRole('button', { name: /Ny aktivitet .* 08:00/ })
    .first()
  await expect(slot).toBeEnabled()
  await slot.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Starttid', { exact: true })).toHaveValue(
    '08:00',
  )
  await dialog.getByLabel('Titel', { exact: true }).fill('E2E serie')
  await dialog.getByLabel('Heldag', { exact: true }).check()
  await dialog
    .getByRole('combobox', { name: 'Upprepning', exact: true })
    .selectOption('weekly')
  await dialog.getByRole('button', { name: 'Spara aktivitet' }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: 'E2E serie, heldag' }).click()
  await page.getByRole('button', { name: /Undanta \d{4}-\d{2}-\d{2}/ }).click()
  await expect(
    page.getByRole('button', { name: 'E2E serie, heldag' }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Nästa period' }).click()
  await expect(
    page.getByRole('button', { name: 'E2E serie, heldag' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'E2E serie, heldag' }).click()
  await page.getByRole('button', { name: 'Radera', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText(
    'Radera hela den återkommande serien?',
  )
  await page.getByRole('button', { name: 'Ja, radera', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'E2E serie, heldag' }),
  ).toHaveCount(0)
})
