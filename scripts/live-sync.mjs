// Real Supabase verification. Input JSON via stdin; credentials never logged or saved.
// Run only against a dedicated Familjen project with provisioned identities.
import { chromium, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
let raw = ''
for await (const part of process.stdin) raw += part
const input = JSON.parse(raw)
raw = ''
const browser = await chromium.launch()
const contexts = []
const clients = []
let created = null
let currentPage = null
let step = 'registration'
const title = `Verifiering ${crypto.randomUUID().slice(0, 8)}`
try {
  for (const person of ['tobias', 'sally']) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: 'block',
    })
    contexts.push(context)
    const page = await context.newPage()
    currentPage = page
    step = `registration ${person}`
    await page.goto(
      `${input.baseUrl}#/registrera?token_hash=${input.links[person].registrationHash}&type=magiclink`,
    )
    await page
      .getByRole('button', { name: 'Registrera den här enheten', exact: true })
      .click()
    await expect(
      page.getByRole('heading', {
        name: new RegExp(`Hej ${person === 'tobias' ? 'Tobias' : 'Sally'}`),
      }),
    ).toBeVisible({ timeout: 30000 })
    await page
      .getByRole('navigation', { name: 'Mobilnavigation' })
      .getByRole('link', { name: 'Kalender' })
      .click()
    await expect(
      page.getByText('Realtid ansluten · Europe/Stockholm', { exact: true }),
    ).toBeVisible({ timeout: 30000 })
    const session = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('familjen.supabase.session')),
    )
    const client = createClient(input.projectUrl, input.publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
    await client.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    })
    clients.push(client)
  }
  const [a, b] = await Promise.all(
    contexts.map((c) => Promise.resolve(c.pages()[0])),
  )
  step = 'create and Realtime delivery'
  await a.getByRole('button', { name: 'Lägg till', exact: true }).click()
  await a.getByRole('dialog').getByLabel('Titel', { exact: true }).fill(title)
  await a.getByRole('button', { name: 'Spara aktivitet' }).click()
  await expect(a.getByRole('dialog')).not.toBeVisible()
  const saved = await clients[0].rpc('calendar_snapshot')
  if (saved.error) throw saved.error
  created = saved.data.activities.find((e) => e.title === title)
  if (!created) throw new Error('Missing saved event')
  await expect(
    b.getByRole('button', { name: new RegExp(`${title},`) }).first(),
  ).toBeVisible({ timeout: 30000 })
  step = 'update from second identity'
  await b
    .getByRole('button', { name: new RegExp(`${title},`) })
    .first()
    .click()
  await b.getByRole('button', { name: 'Redigera', exact: true }).click()
  await b
    .getByRole('dialog')
    .getByLabel('Titel', { exact: true })
    .fill(`${title} ändrad`)
  await b.getByRole('button', { name: 'Spara aktivitet' }).click()
  await expect(
    a.getByRole('button', { name: new RegExp(`${title} ändrad,`) }).first(),
  ).toBeVisible({ timeout: 30000 })
  step = 'offline and reconnection'
  await contexts[1].setOffline(true)
  const snapshot = await clients[0].rpc('calendar_snapshot')
  created = snapshot.data.activities.find((e) => e.id === created.id)
  const updated = await clients[0].rpc('calendar_save', {
    payload: { ...created, title: `${title} återansluten` },
    event_id: created.id,
    expected_version: created.version,
  })
  if (updated.error) throw updated.error
  await contexts[1].setOffline(false)
  await expect(
    b
      .getByRole('button', { name: new RegExp(`${title} återansluten,`) })
      .first(),
  ).toBeVisible({ timeout: 30000 })
  await expect(
    b.getByText('Realtid ansluten · Europe/Stockholm', { exact: true }),
  ).toBeVisible({ timeout: 30000 })
  step = 'persistent session and forged local profile'
  await b.evaluate(() => localStorage.setItem('familjen.profile', 'neo'))
  await b.reload()
  await expect(
    b.getByRole('link', { name: 'Inställningar och profil' }),
  ).toContainText('Sally')
  await expect(
    b
      .getByRole('button', { name: new RegExp(`${title} återansluten,`) })
      .first(),
  ).toBeVisible({ timeout: 30000 })
  step = 'delete and Realtime delivery'
  await b
    .getByRole('button', { name: new RegExp(`${title} återansluten,`) })
    .first()
    .click()
  await b.getByRole('button', { name: 'Radera', exact: true }).click()
  await b.getByRole('button', { name: 'Ja, radera', exact: true }).click()
  await expect(a.getByRole('button', { name: new RegExp(title) })).toHaveCount(
    0,
    { timeout: 30000 },
  )
  step = 'anonymous denial'
  const anon = createClient(input.projectUrl, input.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  for (const table of [
    'families',
    'profiles',
    'calendar_events',
    'event_participants',
    'school_lessons',
    'tasks',
    'shopping_items',
    'chat_messages',
    'push_subscriptions',
    'positions',
    'private_calendar_people',
    'private_calendar_events',
    'private_school_lessons',
    'private_calendar_settings',
  ]) {
    const response = await anon.from(table).select('*').limit(1)
    if (!response.error) throw new Error('Anonymous read unexpectedly allowed')
  }
  for (const [fn, args] of [
    ['calendar_identity', {}],
    ['calendar_snapshot', {}],
    ['calendar_save', { payload: {}, event_id: null, expected_version: null }],
    ['calendar_delete', { event_id: created.id, expected_version: 1 }],
    ['calendar_import', { lessons: [] }],
  ]) {
    const response = await anon.rpc(fn, args)
    if (!response.error) throw new Error('Anonymous RPC unexpectedly allowed')
  }
  step = 'logout clears private UI'
  await b.goto(`${input.baseUrl}#/installningar`)
  await b.getByRole('button', { name: 'Logga ut den här enheten' }).click()
  await expect(b.getByRole('heading', { name: 'Välkommen hem.' })).toBeVisible()
  console.log(
    JSON.stringify({
      realSupabase: true,
      identities: ['tobias', 'sally'],
      registration: true,
      persistedSession: true,
      forgedLocalProfileIgnored: true,
      createUpdateDelete: true,
      realtimeDelivery: true,
      reconnection: true,
      anonymousTablesDenied: 14,
      anonymousRpcsDenied: 5,
      logout: true,
    }),
  )
} catch (error) {
  const scrub = (text) => {
    let safe = String(text)
    for (const link of Object.values(input.links))
      safe = safe.replaceAll(link.registrationHash, '[redacted]')
    safe = safe.replaceAll(input.publishableKey, '[public-key]')
    return safe
      .replace(/https?:\/\/[^\s"']+/g, '[url]')
      .split('\n')
      .slice(0, 8)
      .join('\n')
  }
  console.error(scrub(error.message))
  if (currentPage)
    console.error(
      'Registration UI:',
      scrub(
        await currentPage
          .locator('.auth-gate')
          .textContent()
          .catch(() => ''),
      ),
    )
  console.error(
    `Live verification failed at step: ${step}. Credentials and URLs omitted.`,
  )
  process.exitCode = 1
} finally {
  // Remove only our generated test event, including its tombstone. Normal data is untouched.
  if (created && clients[0]) {
    const snapshot = await clients[0].rpc('calendar_snapshot')
    const event = snapshot.data?.activities?.find((e) => e.id === created.id)
    if (event)
      await clients[0].rpc('calendar_delete', {
        event_id: event.id,
        expected_version: event.version,
      })
  }
  for (const client of clients) await client.auth.signOut({ scope: 'local' })
  await browser.close()
}
