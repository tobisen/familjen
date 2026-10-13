// Run before deployment; input contains ephemeral credentials over stdin only.
import { chromium, expect } from '@playwright/test'
let raw = ''
for await (const part of process.stdin) raw += part
const input = JSON.parse(raw)
raw = ''
const browser = await chromium.launch()
let stage = 'existing registration'
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(
    `${input.baseUrl}#/registrera?token_hash=${input.registrationHash}&type=magiclink`,
  )
  await page
    .getByRole('button', { name: 'Registrera den här enheten', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: /Hej Neo/ })).toBeVisible({
    timeout: 30000,
  })
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect(page.getByRole('heading', { name: /Hej Neo/ })).toBeVisible()
  const before = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('familjen.supabase.session'))
        .refresh_token,
  )
  console.log(
    'READY: prior published service worker controls a registered session; waiting for deployment.',
  )
  stage = 'deployment and update'
  let available = false
  for (let i = 0; i < 180; i++) {
    const manifest = await (
      await fetch(input.baseUrl + 'manifest.webmanifest?verify=' + Date.now())
    ).json()
    if (manifest.id === '/familjen/') {
      available = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  if (!available) throw new Error('Deployment not detected')
  await page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistration()).update(),
  )
  await expect(
    page.getByRole('button', { name: 'Uppdatera appen' }),
  ).toBeVisible({ timeout: 60000 })
  await page.getByRole('button', { name: 'Uppdatera appen' }).click()
  await expect(page.getByRole('heading', { name: /Hej Neo/ })).toBeVisible({
    timeout: 30000,
  })
  await page.waitForTimeout(2000)
  await page.reload()
  await expect(page.getByRole('heading', { name: /Hej Neo/ })).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('familjen.supabase.session'))
          .refresh_token,
    ),
  ).toBe(before)
  stage = 'standalone recovery under active worker'
  await page.goto(input.baseUrl + 'recover/')
  await page.getByRole('button', { name: 'Återställ appens cache' }).click()
  await expect(page.getByRole('heading', { name: /Hej Neo/ })).toBeVisible({
    timeout: 30000,
  })
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('familjen.supabase.session'))
          .refresh_token,
    ),
  ).toBe(before)
  console.log(
    'LIVE PASS: old → new waiting worker → explicit update; saved real session survives update and standalone recovery.',
  )
} catch {
  console.error('LIVE FAIL at ' + stage)
  process.exitCode = 1
} finally {
  await browser.close()
}
