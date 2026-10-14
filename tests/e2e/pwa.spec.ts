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
    await caches.open(
      'familjen-recovery-fixture-' +
        new URL('/familjen/', location.origin).href,
    )
    await caches.open(
      'familjen-precache-v2-' +
        new URL('/familjen/demo/', location.origin).href,
    )
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
  expect(keys.some((key) => key.startsWith('familjen-recovery-fixture-'))).toBe(
    false,
  )
  expect(keys.some((key) => key.endsWith('/familjen/demo/'))).toBe(true)
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
test('diagnostics is read-only, omits auth and distinguishes WebAPK from web cache', async ({
  page,
}) => {
  await page.goto('./recover/')
  await page.evaluate(() => {
    localStorage.setItem(
      'familjen.supabase.session',
      'PRIVATE_SESSION_SENTINEL',
    )
    localStorage.setItem('another-app-session', 'KEEP_OTHER_APP')
  })
  await page.getByRole('button', { name: 'Visa teknisk kontroll' }).click()
  await expect(page.locator('#pwa-report')).toContainText(
    'manifest.webmanifest',
  )
  const report = JSON.parse(await page.locator('#pwa-report').innerText())
  expect(report.manifest.id).toBe(new URL('/familjen/', page.url()).href)
  expect(report.manifest.startUrl).toBe(report.manifest.id)
  expect(report.manifest.scope).toBe(report.manifest.id)
  expect(
    report.icons.every((icon: { status: number }) => icon.status === 200),
  ).toBe(true)
  expect(report.androidWebApk).toContain('Kan inte läsas')
  expect(JSON.stringify(report)).not.toContain('PRIVATE_SESSION_SENTINEL')
  expect(
    await page.evaluate(() =>
      localStorage.getItem('familjen.supabase.session'),
    ),
  ).toBe('PRIVATE_SESSION_SENTINEL')
  expect(
    await page.evaluate(() => localStorage.getItem('another-app-session')),
  ).toBe('KEEP_OTHER_APP')
  await expect(
    page.getByText('Den kan inte avregistrera', { exact: false }),
  ).toBeVisible()
})
test('PNG icons decode at their declared dimensions and manifest URL stays identical at all entrypoints', async ({
  page,
}) => {
  for (const path of ['./', './register/']) {
    await page.goto(path)
    const manifest = await page
      .locator('link[rel="manifest"]')
      .getAttribute('href')
    expect(new URL(manifest!, page.url()).pathname).toBe(
      '/familjen/manifest.webmanifest',
    )
  }
  const m = await (
    await page.request.get('/familjen/manifest.webmanifest')
  ).json()
  for (const icon of m.icons) {
    const buffer = await (await page.request.get(icon.src)).body()
    expect(
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    ).toBe(true)
    expect(`${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`).toBe(
      icon.sizes,
    )
    const dimensions = await page.evaluate(async (src: string) => {
      const icon = new Image()
      icon.src = src
      await icon.decode()
      return `${icon.naturalWidth}x${icon.naturalHeight}`
    }, icon.src)
    expect(dimensions).toBe(icon.sizes)
  }
})
test('direct install button is gated by browser event and preserves session without claiming launch success', async ({
  page,
}) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'N Neo' }).click()
  await page.goto('./#/installningar')
  await expect(
    page.getByRole('button', { name: 'Installera Familjen', exact: true }),
  ).not.toBeVisible()
  await page.evaluate(() => {
    localStorage.setItem(
      'familjen.supabase.session',
      'INSTALL_SESSION_SENTINEL',
    )
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(event, {
      prompt: () => Promise.resolve(),
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    })
    window.dispatchEvent(event)
  })
  await page
    .getByRole('button', { name: 'Installera Familjen', exact: true })
    .click()
  await expect(
    page.getByText('Installationsbegäran skickad.', { exact: false }),
  ).toBeVisible()
  expect(
    await page.evaluate(() =>
      localStorage.getItem('familjen.supabase.session'),
    ),
  ).toBe('INSTALL_SESSION_SENTINEL')
  await expect(
    page.getByRole('button', { name: 'Installera Familjen', exact: true }),
  ).not.toBeVisible()
})

test('built service worker imports the current push handler rather than only precaching it', async ({
  request,
}) => {
  const sw = await request.get('sw.js')
  expect(sw.ok()).toBe(true)
  const match = (await sw.text()).match(
    /importScripts\("(push-sw\.js\?v=[a-f0-9]{12})"\)/,
  )
  expect(match, 'Worker must execute the push handler').not.toBeNull()
  const handler = await request.get(match![1]!)
  expect(handler.ok()).toBe(true)
  expect(await handler.text()).toContain('FAMILJEN_PUSH_OWNER')
  expect(await handler.text()).toContain('notificationclick')
})
