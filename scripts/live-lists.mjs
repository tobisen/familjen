// Real hosted Supabase + browser verification; ephemeral tokens arrive on stdin, never logs.
import { chromium, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
let raw = ''
for await (const part of process.stdin) raw += part
const input = JSON.parse(raw)
raw = ''
const browser = await chromium.launch()
const contexts = [],
  pages = [],
  clients = []
const prefix = 'Verifiering ' + crypto.randomUUID().slice(0, 8)
let stage = 'registration'
const check = async (value, message) => {
  if (!value) throw new Error(message)
}
try {
  for (const person of ['tobias', 'neo', 'sally']) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: 'block',
    })
    contexts.push(context)
    const page = await context.newPage()
    pages.push(page)
    await page.goto(
      `${input.baseUrl}#/registrera?token_hash=${input.links[person].registrationHash}&type=magiclink`,
    )
    await page
      .getByRole('button', { name: 'Registrera den här enheten', exact: true })
      .click()
    await expect(
      page.getByRole('heading', {
        name: new RegExp('Hej ' + person[0].toUpperCase() + person.slice(1)),
      }),
    ).toBeVisible({ timeout: 30000 })
    await page
      .getByRole('navigation', { name: 'Mobilnavigation' })
      .getByRole('link', { name: 'Listor', exact: true })
      .click()
    await expect(
      page.getByText('Realtid ansluten', { exact: true }),
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
  const [a, b, c] = pages
  stage = 'task create and three-way realtime'
  await a.getByRole('button', { name: 'Ny uppgift' }).click()
  let dialog = a.getByRole('dialog')
  await dialog.getByLabel('Titel', { exact: true }).fill(prefix + ' uppgift')
  await dialog.getByLabel('Neo', { exact: true }).check()
  await dialog.getByLabel('Sally', { exact: true }).check()
  await dialog.getByLabel('Deadline', { exact: true }).fill('2026-10-14')
  await dialog.getByLabel('Återkomst', { exact: true }).selectOption('daily')
  await dialog.getByRole('button', { name: 'Spara', exact: true }).click()
  for (const page of pages)
    await expect(
      page.getByRole('heading', { name: prefix + ' uppgift', exact: true }),
    ).toBeVisible({ timeout: 20000 })
  stage = 'task edit and completion'
  await b
    .getByRole('button', {
      name: 'Redigera ' + prefix + ' uppgift',
      exact: true,
    })
    .click()
  dialog = b.getByRole('dialog')
  await dialog
    .getByLabel('Beskrivning')
    .fill('Tillfällig verifiering som raderas av testet')
  await dialog.getByRole('button', { name: 'Spara', exact: true }).click()
  for (const page of pages)
    await expect(
      page.locator('.task-row').filter({ hasText: prefix + ' uppgift' }),
    ).toContainText('Tillfällig verifiering', { timeout: 20000 })
  await c
    .getByRole('button', {
      name: 'Slutför ' + prefix + ' uppgift',
      exact: true,
    })
    .click()
  for (const page of pages)
    await expect(
      page.locator('.task-row').filter({ hasText: prefix + ' uppgift' }),
    ).toContainText('2026-10-15', { timeout: 20000 })
  await c.getByRole('button', { name: 'Klara', exact: true }).click()
  await expect(
    c.locator('.task-row').filter({ hasText: prefix + ' uppgift' }),
  ).toContainText('Klar av Sally')
  await c.getByRole('button', { name: 'Aktiva', exact: true }).click()
  stage = 'shopping realtime and history'
  for (const page of pages)
    await page.getByRole('button', { name: /^Inköp / }).click()
  await a.getByLabel('Varunamn', { exact: true }).fill(prefix + ' vara')
  await a.getByLabel('Antal', { exact: true }).fill('2')
  await a.getByRole('button', { name: 'Lägg till vara', exact: true }).click()
  for (const page of pages)
    await expect(
      page.getByRole('button', {
        name: 'Köp ' + prefix + ' vara',
        exact: true,
      }),
    ).toBeVisible({ timeout: 20000 })
  await b
    .getByRole('button', { name: 'Köp ' + prefix + ' vara', exact: true })
    .click()
  for (const page of pages)
    await expect(
      page.getByRole('button', {
        name: 'Köp ' + prefix + ' vara',
        exact: true,
      }),
    ).not.toBeVisible({ timeout: 20000 })
  await c.getByRole('button', { name: /Köphistorik/ }).click()
  await c
    .getByRole('button', { name: 'Återställ ' + prefix + ' vara', exact: true })
    .click()
  for (const page of pages)
    await expect(
      page.getByRole('button', {
        name: 'Köp ' + prefix + ' vara',
        exact: true,
      }),
    ).toBeVisible({ timeout: 20000 })
  let { data: snapshot, error } = await clients[0].rpc('lists_snapshot')
  if (error) throw error
  let item = snapshot.shopping.find((s) => s.title === prefix + ' vara')
  stage = 'simultaneous purchase is idempotent'
  const purchased = await Promise.all(
    clients.slice(0, 2).map((client) =>
      client.rpc('lists_set_done', {
        kind: 'shopping',
        item_id: item.id,
        done: true,
        expected_version: item.version,
      }),
    ),
  )
  await check(
    purchased.every((r) => !r.error),
    'Concurrent purchase failed',
  )
  for (const page of pages)
    await expect(
      page.getByRole('button', {
        name: 'Köp ' + prefix + ' vara',
        exact: true,
      }),
    ).not.toBeVisible({ timeout: 20000 })
  ;({ data: snapshot, error } = await clients[0].rpc('lists_snapshot'))
  if (error) throw error
  item = snapshot.shopping.find((s) => s.id === item.id)
  stage = 'simultaneous editing detects conflict'
  const edits = await Promise.all(
    clients.slice(0, 2).map((client, index) =>
      client.rpc('lists_save', {
        kind: 'shopping',
        item_id: item.id,
        expected_version: item.version,
        payload: { title: prefix + ' vara', amount: index + 3, unit: 'st' },
      }),
    ),
  )
  await check(
    edits.filter((r) => r.error).length === 1,
    'Expected exactly one stale edit conflict',
  )
  stage = 'offline reconnection'
  await contexts[2].setOffline(true)
  await a
    .getByLabel('Varunamn', { exact: true })
    .fill(prefix + ' återanslutning')
  await a.getByRole('button', { name: 'Lägg till vara', exact: true }).click()
  await expect(
    b.getByRole('button', {
      name: 'Köp ' + prefix + ' återanslutning',
      exact: true,
    }),
  ).toBeVisible({ timeout: 20000 })
  await contexts[2].setOffline(false)
  await expect(
    c.getByRole('button', {
      name: 'Köp ' + prefix + ' återanslutning',
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 })
  await expect(c.getByText('Realtid ansluten', { exact: true })).toBeVisible({
    timeout: 30000,
  })
  stage = 'anonymous access denied'
  const anonymous = createClient(input.projectUrl, input.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  for (const table of ['tasks', 'task_assignees', 'shopping_items'])
    await check(
      !!(await anonymous.from(table).select('*').limit(1)).error,
      'Anonymous table readable',
    )
  for (const [fn, args] of [
    ['lists_snapshot', {}],
    [
      'lists_save',
      {
        kind: 'shopping',
        payload: { title: 'Forbidden', amount: 1, unit: '' },
        request_id: crypto.randomUUID(),
      },
    ],
    [
      'lists_set_done',
      { kind: 'shopping', item_id: item.id, done: false, expected_version: 1 },
    ],
    [
      'lists_delete',
      { kind: 'shopping', item_id: item.id, expected_version: 1 },
    ],
  ])
    await check(
      !!(await anonymous.rpc(fn, args)).error,
      'Anonymous RPC executable',
    )
  stage = 'saved session'
  await b.reload()
  await expect(
    b.getByRole('button', {
      name: 'Köp ' + prefix + ' återanslutning',
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 })
  console.log(
    'LIVE PASS: Tobias/Neo/Sally; task CRUD/assignees/recurrence/audit; shopping purchase/history/restore; three-session Realtime; simultaneous purchase and stale edit conflict; offline reconnect; saved session; anonymous tables/RPC denied.',
  )
} catch {
  console.error('LIVE FAIL at ' + stage)
  process.exitCode = 1
} finally {
  // Remove only this run's clearly labelled verification rows, including generated occurrences.
  if (clients[0]) {
    const { data, error } = await clients[0].rpc('lists_snapshot')
    if (!error)
      for (const [kind, rows] of [
        ['task', data.tasks],
        ['shopping', data.shopping],
      ])
        for (const row of rows.filter((r) => r.title.startsWith(prefix))) {
          const result = await clients[0].rpc('lists_delete', {
            kind,
            item_id: row.id,
            expected_version: row.version,
          })
          if (result.error) {
            console.error('Test cleanup failed')
            process.exitCode = 1
          }
        }
  }
  for (const client of clients) await client.removeAllChannels()
  await browser.close()
}
