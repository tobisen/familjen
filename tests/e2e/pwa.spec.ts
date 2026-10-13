import { test, expect } from '@playwright/test'
test('manifest identity, rooted paths and physical Pages entrypoints', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('./')
  const response = await page.request.get('manifest.webmanifest')
  const m = await response.json()
  expect(m).toMatchObject({
    id: '/familjen/',
    start_url: '/familjen/',
    scope: '/familjen/',
    name: 'Familjen – vår vardag tillsammans',
    short_name: 'Familjen',
    display: 'standalone',
  })
  for (const icon of m.icons)
    expect((await page.request.get(icon.src)).ok()).toBe(true)
  for (const path of ['register/', 'recover/', 'boot.js', 'sw.js'])
    expect((await page.request.get(path)).ok()).toBe(true)
  await page.goto('./register/')
  await expect(
    page.getByRole('heading', { name: 'Välkommen till Familjen.' }),
  ).toBeVisible()
  expect(errors).toEqual([])
})
test('standalone recovery preserves session and unrelated caches', async ({
  page,
}) => {
  await page.goto('./recover/')
  await page.evaluate(async () => {
    localStorage.setItem('familjen.supabase.session', 'preserve-test-session')
    localStorage.setItem('familjen.profile', 'neo')
    await caches.open('familjen-recovery-fixture')
    await caches.open('other-app-cache')
  })
  await page.getByRole('button', { name: 'Återställ appens cache' }).click()
  await page.waitForURL(/repair=/)
  expect(
    await page.evaluate(() =>
      localStorage.getItem('familjen.supabase.session'),
    ),
  ).toBe('preserve-test-session')
  const keys = await page.evaluate(() => caches.keys())
  expect(keys).not.toContain('familjen-recovery-fixture')
  expect(keys).toContain('other-app-cache')
  await expect(page.getByRole('heading', { name: /Hej Neo/ })).toBeVisible()
})
test('startup fallback is usable when the app JavaScript is unavailable', async ({
  page,
}) => {
  await page.route('**/assets/index-*.js', (route) => route.abort())
  await page.goto('./')
  await expect(
    page.getByRole('button', { name: 'Återställ appens cache' }),
  ).toBeVisible({ timeout: 15000 })
  await expect(
    page.getByRole('link', { name: 'Hjälp att starta appen' }),
  ).toHaveAttribute('href', '/familjen/recover/')
})
