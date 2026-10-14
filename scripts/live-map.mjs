// Hosted verification with an isolated family. Input sessions and all coordinates stay out of logs.
import { chromium, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
let raw = ''
for await (const chunk of process.stdin) raw += chunk
const input = JSON.parse(raw)
raw = ''
const browser = await chromium.launch(),
  contexts = [],
  pages = [],
  clients = []
let stage = 'start',
  success = false
try {
  for (const [i, person] of ['tobias', 'neo', 'sally'].entries()) {
    stage = 'authenticated GPS ' + person
    const context = await browser.newContext({
      viewport: { width: 393, height: 851 },
      serviceWorkers: 'block',
      permissions: ['geolocation'],
      geolocation: {
        latitude: 59.86 + i * 0.003,
        longitude: 17.64 + i * 0.003,
        accuracy: 15,
      },
    })
    contexts.push(context)
    await context.route('https://tile.openstreetmap.org/**', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/B9sAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    )
    await context.addInitScript(
      (s) =>
        localStorage.setItem('familjen.supabase.session', JSON.stringify(s)),
      input.sessions[person],
    )
    const page = await context.newPage()
    pages.push(page)
    await page.goto(input.baseUrl + '#/karta')
    await expect(page.getByText(/Realtid ansluten · GPS används/)).toBeVisible({
      timeout: 30000,
    })
    await expect(page.locator('.family-marker')).toHaveCount(i + 1, {
      timeout: 30000,
    })
    const c = createClient(input.projectUrl, input.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    await c.auth.setSession(input.sessions[person])
    clients.push(c)
  }
  stage = 'three-session GPS realtime'
  for (const p of pages)
    await expect(p.locator('.family-marker')).toHaveCount(3, { timeout: 20000 })
  const before = (await clients[0].rpc('map_snapshot')).data
  const neo = before.people.find((p) => p.key === 'neo').id
  await new Promise((r) => setTimeout(r, 11000))
  await contexts[1].setGeolocation({
    latitude: 59.88,
    longitude: 17.66,
    accuracy: 10,
  })
  for (const p of pages)
    await expect(
      p.locator('.map-person').filter({ hasText: 'Neo' }),
    ).toContainText('±10 m', { timeout: 20000 })
  stage = 'reconnect GPS snapshot'
  await contexts[2].setOffline(true)
  await new Promise((r) => setTimeout(r, 11000))
  const written = await clients[1].rpc('map_report', {
    latitude: 59.89,
    longitude: 17.67,
    accuracy: 7,
    recorded_at: new Date().toISOString(),
  })
  if (written.error || !written.data.accepted) throw Error('Report failed')
  await contexts[2].setOffline(false)
  await expect(
    pages[2].locator('.map-person').filter({ hasText: 'Neo' }),
  ).toContainText('±7 m', { timeout: 30000 })
  stage = 'help confirmation and real chat synchronization'
  for (const p of [pages[0], pages[2]])
    await p
      .getByRole('navigation', { name: 'Huvudnavigation' })
      .getByRole('link', { name: 'Chatt', exact: true })
      .click()
  await pages[1].getByRole('button', { name: 'Be familjen om hjälp' }).click()
  await expect(pages[1].getByRole('dialog')).toBeVisible()
  const empty = await clients[0].rpc('chat_page')
  if (empty.error || empty.data.length)
    throw Error('Help sent before confirmation')
  await pages[1]
    .getByRole('button', { name: 'Ja, skicka hjälpmeddelande' })
    .click()
  await expect(pages[1].locator('.help-result')).toContainText(
    'Ingen ansluten notisenhet',
    { timeout: 20000 },
  )
  for (const p of [pages[0], pages[2]])
    await expect(p.locator('.chat-message')).toContainText(
      'Jag behöver hjälp',
      { timeout: 20000 },
    )
  const history = (await clients[0].rpc('chat_page')).data
  const help = history.find((m) => m.kind === 'help')
  if (!help) throw Error('Missing help')
  const old = await clients[1].rpc('map_report', {
    latitude: 59,
    longitude: 17,
    accuracy: 1,
    recorded_at: new Date(Date.now() - 180000).toISOString(),
  })
  if (!old.error) throw Error('Old report accepted')
  const duplicate = await clients[1].rpc('map_help', {
    request_id: help.client_request_id,
  })
  if (duplicate.error || duplicate.data !== help.id)
    throw Error('Help retry duplicated')
  await pages[0].getByRole('link', { name: 'Visa hjälpposition' }).click()
  await expect(pages[0].getByText(/Hjälpposition från/)).toBeVisible()
  stage = 'logout isolation'
  await pages[1].getByRole('link', { name: 'Inställningar och profil' }).click()
  await pages[1]
    .getByRole('button', { name: 'Logga ut den här enheten' })
    .click()
  await expect(
    pages[1].getByRole('heading', { name: 'Välkommen hem.' }),
  ).toBeVisible()
  await expect(
    pages[0].getByRole('heading', { name: 'Familjekarta' }),
  ).toBeVisible()
  if (!neo) throw Error('Identity not server-bound')
  success = true
} catch {
  process.exitCode = 1
} finally {
  for (const c of clients) await c.auth.signOut({ scope: 'local' })
  await browser.close()
  console.log(
    JSON.stringify({
      success,
      stage,
      sessions: 3,
      physicalGps: false,
      physicalPush: false,
    }),
  )
}
