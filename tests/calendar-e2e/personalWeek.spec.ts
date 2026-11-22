import { readFileSync } from 'node:fs'
const nestedExample = JSON.parse(
  readFileSync('tests/fixtures/personal-week-nested.json', 'utf8'),
)
import { test, expect } from '@playwright/test'
import type { PGlite } from '@electric-sql/pglite'
import { calendarDatabase, calendarRpc, testUser } from '../support/database'
import { personalApi } from '../support/personalApi'
let db: PGlite
const tobias = '00000000-0000-0000-0000-000000000013',
  sally = '00000000-0000-0000-0000-000000000012'
const sample = {
  year: 2026,
  week: 53,
  weekType: 'barnfri',
  focus: ['Balans'],
  days: [
    {
      date: '2026-12-28',
      weekday: 1,
      priority: 'high',
      training: ['Promenad', 'Rörlighet'],
      food: ['Soppa'],
    },
  ],
  weeklySummary: { trainingGoal: 'Två pass', economy: 'Veckobudget' },
  weeklyTasks: ['Boka tid'],
}
test.beforeEach(async ({ context }) => {
  db = await calendarDatabase()
  await db.exec(
    `insert into auth.users values ('${tobias}'),('${sally}'); update public.profiles set auth_user_id='${tobias}' where profile_key='tobias'; update public.profiles set auth_user_id='${sally}' where profile_key='sally'`,
  )
  await personalApi(context, db, tobias)
})
test.afterEach(async () => db.close())
test('private mobile import, preview, editing, ordering, tasks, persistence and week navigation', async ({
  page,
}) => {
  await page.goto('./#/min-vecka?year=2026&week=53')
  await expect(
    page.getByRole('heading', { name: 'Min vecka', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Min vecka', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('navigation', { name: 'Huvudnavigation' }).getByRole('link'),
  ).toHaveCount(4)
  await page
    .getByRole('button', { name: 'Importera vecka', exact: true })
    .first()
    .click()
  let dialog = page.getByRole('dialog')
  await dialog
    .getByLabel('Veckoplan som JSON')
    .fill(
      `--- FAMILJEN WEEK IMPORT ---\n${JSON.stringify(sample)}\n--- END ---`,
    )
  await dialog
    .getByRole('button', { name: 'Validera och förhandsgranska' })
    .click()
  await expect(dialog.locator('.personal-day')).toHaveCount(7)
  await expect(dialog).toContainText('Två pass')
  await expect(dialog).toContainText('Promenad')
  await dialog.getByRole('button', { name: 'Bekräfta import' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByText('Veckan importerades.')).toBeVisible()
  await page.getByLabel('Klar: Boka tid', { exact: true }).check()
  await expect(page.getByText('1/1 klara')).toBeVisible()
  await page.getByLabel('Klar: Boka tid', { exact: true }).uncheck()
  await expect(
    page
      .getByRole('region', { name: 'Veckouppgifter', exact: true })
      .getByText('0/1 klara'),
  ).toBeVisible()
  await page.getByLabel('Redigera Promenad', { exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Innehåll').fill('Styrkepass')
  await dialog.getByRole('button', { name: 'Spara ändring' }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByLabel('Flytta ned Styrkepass').click()
  await expect(
    page.locator('.personal-day').first().locator('.personal-item').first(),
  ).toContainText('Rörlighet')
  await page.getByLabel('Lägg till post 2026-12-28').click()
  await page.getByRole('dialog').getByLabel('Kategori').selectOption('selfCare')
  await page.getByRole('dialog').getByLabel('Innehåll').fill('Läsa')
  await page.getByRole('button', { name: 'Spara ändring' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByLabel('Ändra prioritet 2026-12-28').click()
  await page.getByRole('dialog').getByLabel('Prioritet').selectOption('low')
  await page.getByRole('button', { name: 'Spara ändring' }).click()
  await expect(page.locator('.personal-day').first()).toContainText(
    'Låg prioritet',
  )
  await page.getByRole('button', { name: 'Ändra fokus' }).click()
  await page.getByLabel('Fokus, en etikett per rad').fill('Återhämtning\nHälsa')
  await page.getByRole('button', { name: 'Spara ändring' }).click()
  await expect(page.locator('.focus-tags')).toContainText('Hälsa')
  await page.getByRole('button', { name: 'Redigera sammanfattning' }).click()
  await page
    .getByRole('dialog')
    .getByLabel('Ekonomi', { exact: true })
    .fill('Spara 500 kr')
  await page.getByRole('button', { name: 'Spara ändring' }).click()
  await expect(page.locator('.personal-summary')).toContainText('Spara 500 kr')
  await page.getByRole('button', { name: 'Ny veckouppgift' }).click()
  await page
    .getByRole('dialog')
    .getByLabel('Uppgift', { exact: true })
    .fill('Boka träning')
  await page.getByRole('button', { name: 'Spara ändring' }).click()
  await expect(page.getByLabel('Klar: Boka träning')).toBeVisible()
  await page.getByLabel('Redigera Läsa', { exact: true }).click()
  await page.getByRole('button', { name: 'Ta bort', exact: true }).click()
  await page.getByRole('button', { name: 'Ja, ta bort', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByLabel('Redigera Läsa')).toHaveCount(0)
  await page.reload()
  await expect(page.getByLabel('Klar: Boka träning')).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: test.info().outputPath('min-vecka-mobile.png'),
    fullPage: true,
  })
  await page.setViewportSize({ width: 320, height: 740 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.getByLabel('Nästa vecka').click()
  await expect(
    page.getByRole('heading', { name: 'Vecka 1 · 2027' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Plats för din vecka' }),
  ).toBeVisible()
  await page.getByLabel('Föregående vecka').click()
  await expect(page.getByLabel('Klar: Boka träning')).toBeVisible()
})
test('existing week requires replacement confirmation, cancellation preserves edits, failed replacement is atomic', async ({
  page,
}) => {
  const { validatePersonalPlan } = await import('../../src/domain/personalWeek')
  await calendarRpc(
    db,
    'personal_week_save',
    { payload: validatePersonalPlan(sample), request_id: crypto.randomUUID() },
    tobias,
  )
  await page.goto('./#/min-vecka?year=2026&week=53')
  await page.getByLabel('Klar: Boka tid', { exact: true }).check()
  await expect(page.getByText('1/1 klara')).toBeVisible()
  async function preview() {
    await page
      .getByRole('button', { name: 'Importera vecka', exact: true })
      .first()
      .click()
    await page.getByLabel('Veckoplan som JSON').fill(JSON.stringify(sample))
    await page
      .getByRole('button', { name: 'Validera och förhandsgranska' })
      .click()
    await expect(page.getByRole('dialog')).toContainText('Veckan finns redan.')
  }
  await preview()
  await expect(
    page.getByRole('button', { name: 'Ersätt veckan' }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Avbryt', exact: true }).click()
  await expect(page.getByText('1/1 klara')).toBeVisible()
  await preview()
  await page.getByLabel('Jag vill ersätta den befintliga veckan').check()
  await page.route('**/rpc/personal_week_save', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Test: sparningen misslyckades' }),
    }),
  )
  await page.getByRole('button', { name: 'Ersätt veckan' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Test: sparningen misslyckades',
  )
  const saved = (await calendarRpc(
    db,
    'personal_week_snapshot',
    { target_year: 2026, target_week: 53 },
    tobias,
  )) as { tasks: { done: boolean }[] }
  expect(saved.tasks[0]!.done).toBe(true)
  await page.unroute('**/rpc/personal_week_save')
  await page.getByRole('button', { name: 'Ersätt veckan' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(
    page
      .getByRole('region', { name: 'Veckouppgifter', exact: true })
      .getByText('0/1 klara'),
  ).toBeVisible()
})
test('validation errors identify the invalid field before import', async ({
  page,
}) => {
  await page.goto('./#/min-vecka')
  await page
    .getByRole('button', { name: 'Importera vecka', exact: true })
    .first()
    .click()
  await page
    .getByLabel('Veckoplan som JSON')
    .fill(JSON.stringify({ ...sample, days: [{ date: '2026-12-35' }] }))
  await page
    .getByRole('button', { name: 'Validera och förhandsgranska' })
    .click()
  await expect(page.getByRole('alert')).toContainText('days[0].date')
  await expect(
    page.getByRole('button', { name: 'Bekräfta import' }),
  ).toHaveCount(0)
})
for (const [name, user] of [
  ['Neo', testUser],
  ['Sally', sally],
])
  test(`${name} cannot access private route or gain access by changing local profile`, async ({
    page,
    context,
  }) => {
    await personalApi(context, db, user)
    await page.goto('./#/min-vecka')
    await expect(
      page.getByRole('heading', { name: 'Kalender', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Min vecka', exact: true }),
    ).toHaveCount(0)
    await page.evaluate(() =>
      localStorage.setItem('familjen.profile', 'tobias'),
    )
    await page.goto('./#/min-vecka')
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Kalender', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Min vecka', exact: true }),
    ).toHaveCount(0)
  })

test('signed-out direct navigation requires registration', async ({
  page,
  context,
}) => {
  await context.addInitScript(() =>
    localStorage.removeItem('familjen.supabase.session'),
  )
  await page.goto('./#/min-vecka')
  await expect(
    page.getByRole('heading', { name: 'Min vecka', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('link', { name: 'Min vecka', exact: true }),
  ).toHaveCount(0)
  await expect(page.locator('.auth-gate')).toBeVisible()
})

test('failed checkbox update restores the previous state and allows retry', async ({
  page,
}) => {
  const { validatePersonalPlan } = await import('../../src/domain/personalWeek')
  await calendarRpc(
    db,
    'personal_week_save',
    { payload: validatePersonalPlan(sample), request_id: crypto.randomUUID() },
    tobias,
  )
  await page.goto('./#/min-vecka?year=2026&week=53')
  const checkbox = page.getByLabel('Klar: Boka tid', { exact: true })
  await expect(checkbox).not.toBeChecked()
  await page.route('**/rpc/personal_week_save', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Test: ändringen kunde inte sparas' }),
    }),
  )
  await checkbox.click()
  await expect(page.getByRole('alert')).toContainText(
    'Test: ändringen kunde inte sparas',
  )
  await expect(checkbox).not.toBeChecked()
  await page.unroute('**/rpc/personal_week_save')
  await checkbox.check()
  await expect(page.getByText('1/1 klara')).toBeVisible()
  await expect(page.getByText('Ändringen sparades.')).toBeVisible()
  await page.reload()
  await expect(checkbox).toBeChecked()
})

test('imports nested ChatGPT JSON with scalar categories, day names and economy tasks', async ({
  page,
}) => {
  await page.goto('./#/min-vecka?year=2026&week=48')
  await page
    .getByRole('button', { name: 'Importera vecka', exact: true })
    .first()
    .click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByLabel('Veckoplan som JSON')
    .fill(
      `--- FAMILJEN WEEK IMPORT ---\n${JSON.stringify(nestedExample)}\n--- END ---`,
    )
  await dialog
    .getByRole('button', { name: 'Validera och förhandsgranska' })
    .click()
  await expect(
    dialog.getByRole('heading', { name: 'Vecka 48 · 2026 · Barnvecka' }),
  ).toBeVisible()
  await expect(dialog.locator('.focus-tags')).toContainText('Balans')
  await expect(dialog.locator('.personal-day').first()).toContainText(
    'Arbetsdag',
  )
  await expect(
    dialog.getByRole('region', { name: 'Veckouppgifter' }),
  ).toContainText('Ekonomi')
  await dialog.getByRole('button', { name: 'Bekräfta import' }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByLabel('Redigera Stäm av budget', { exact: true }).click()
  await expect(page.getByRole('dialog').getByLabel('Kategori')).toHaveValue(
    'economy',
  )
  await page
    .getByRole('dialog')
    .getByLabel('Uppgift', { exact: true })
    .fill('Kontrollera budget')
  await page.getByRole('button', { name: 'Spara ändring' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByLabel('Klar: Kontrollera budget', { exact: true }).check()
  await expect(page.getByText('Ändringen sparades.')).toBeVisible()
  await page.reload()
  await expect(
    page.getByLabel('Klar: Kontrollera budget', { exact: true }),
  ).toBeChecked()
  await expect(
    page.getByRole('region', { name: 'Veckouppgifter' }),
  ).toContainText('Ekonomi')
})
