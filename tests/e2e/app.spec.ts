import { test, expect } from '@playwright/test'
test('profile persists, routes work, quick add is honest', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'N Neo' }).click()
  await expect(page.getByRole('heading', { name: /Hej Neo/ })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: /Hej Neo/ })).toBeVisible()
  for (const [path, heading] of [
    ['kalender', 'Kalender'],
    ['listor', 'Listor'],
    ['chatt', 'Chatt'],
    ['karta', 'Karta'],
    ['installningar', 'Inställningar'],
  ]) {
    await page.goto(`./#/${path}`)
    await expect(
      page.getByRole('heading', { name: heading, exact: true }),
    ).toBeVisible()
  }
  await page.getByRole('button', { name: 'S Sally' }).click()
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /Hej Sally/ })).toBeVisible()
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
  await expect(page.getByRole('heading', { name: /Hej Tobias/ })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('offline')
  await context.setOffline(false)
})
