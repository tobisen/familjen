import { test, expect } from '@playwright/test'
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/B9sAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  )
})
test('profile persists, routes work, quick add is honest', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'N Neo' }).click()
  await expect(
    page.getByRole('heading', { name: 'Kalender', exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Kalender', exact: true }),
  ).toBeVisible()
  for (const [path, heading] of [
    ['kalender', 'Kalender'],
    ['listor', 'Att göra'],
    ['chatt', 'Chatt'],
    ['karta', 'Familjekarta'],
    ['installningar', 'Inställningar'],
  ]) {
    await page.goto(`./#/${path}`)
    await expect(
      page.getByRole('heading', { name: heading, exact: true, level: 1 }),
    ).toBeVisible()
  }
  await expect(page.getByRole('button', { name: 'S Sally' })).toHaveCount(0)
  await page.goto('./')
  await expect(
    page.getByRole('heading', { name: 'Kalender', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Ingenting sparas ännu.')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})
test('manifest and offline app shell', async ({ page, context }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'T Tobias' }).click()
  const manifest = await page.request.get('manifest.webmanifest')
  expect(manifest.ok()).toBe(true)
  expect((await manifest.json()).icons).toHaveLength(3)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Kalender', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('status').filter({ hasText: 'Du är offline' }),
  ).toBeVisible()
  await context.setOffline(false)
})

test('four sticky top tabs, preserved calendar view, locked profile and persistent theme', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'N Neo' }).click()
  const nav = page.getByRole('navigation', { name: 'Huvudnavigation' })
  await expect(nav.getByRole('link')).toHaveCount(4)
  expect(
    await page.evaluate(() => document.documentElement.dataset.theme),
  ).toBe('dark')
  await page.getByRole('button', { name: 'Månad', exact: true }).click()
  await nav.getByRole('link', { name: 'Att göra', exact: true }).click()
  await nav.getByRole('link', { name: 'Inköp', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Inköp', level: 1 }),
  ).toBeVisible()
  await nav.getByRole('link', { name: 'Kalender', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Månad', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => window.scrollTo(0, 500))
  expect((await nav.boundingBox())!.y).toBeGreaterThanOrEqual(0)
  expect((await nav.boundingBox())!.y).toBeLessThan(50)
  await page.getByRole('link', { name: 'Inställningar och profil' }).click()
  await expect(
    page.getByRole('button', { name: /S Sally|T Tobias/ }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Ljust', exact: true }).click()
  await page.reload()
  expect(
    await page.evaluate(() => document.documentElement.dataset.theme),
  ).toBe('light')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})
