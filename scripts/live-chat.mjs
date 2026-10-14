// Hosted chat verification. Input session tokens stay in memory; stdout contains only test-row IDs/status.
import { chromium, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
let raw = ''
for await (const chunk of process.stdin) raw += chunk
const input = JSON.parse(raw)
raw = ''
const browser = await chromium.launch(),
  pages = [],
  contexts = [],
  clients = [],
  requests = []
const prefix = 'Verifiering ' + crypto.randomUUID().slice(0, 8)
let stage = 'registration',
  success = false
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
  stage = 'three-way chat realtime'
  for (const [index, page] of pages.entries()) {
    stage = 'chat connection ' + index
    await page
      .getByRole('navigation', { name: 'Mobilnavigation' })
      .getByRole('link', { name: /Chatt/ })
      .click()
    await expect(
      page.getByText('Realtid ansluten', { exact: true }),
    ).toBeVisible({ timeout: 30000 })
  }
  // Capture only this run's request IDs for exact administrative cleanup, including lost acknowledgements.
  for (const page of pages)
    page.on('request', (request) => {
      if (request.url().endsWith('/rpc/chat_send')) {
        const id = request.postDataJSON()?.request_id
        if (id) requests.push(id)
      }
    })
  stage = 'initial send'
  await a
    .getByLabel('Meddelande', { exact: true })
    .fill(prefix + ' hej 👋 https://example.com')
  await a.getByRole('button', { name: 'Skicka meddelande' }).click()
  for (const [index, page] of pages.entries()) {
    stage = 'initial delivery ' + index
    await expect(
      page
        .locator('.chat-message:not(.pending-message)')
        .filter({ hasText: prefix + ' hej' }),
    ).toHaveCount(1, { timeout: 20000 })
  }
  await expect(
    a.locator('.chat-message').filter({ hasText: prefix + ' hej' }),
  ).toHaveClass(/is-own/)
  await expect(
    b.locator('.chat-message').filter({ hasText: prefix + ' hej' }),
  ).not.toHaveClass(/is-own/)
  stage = 'sender-only editing and deletion'
  const own = a.locator('.chat-message').filter({ hasText: prefix + ' hej' })
  await own.getByRole('button', { name: /Redigera/ }).click()
  await a.getByLabel('Ny meddelandetext').fill(prefix + ' ändrat')
  await a.getByRole('button', { name: 'Spara ändring' }).click()
  for (const page of pages)
    await expect(
      page.getByText(prefix + ' ändrat', { exact: true }),
    ).toBeVisible({ timeout: 20000 })
  const history = await clients[0].rpc('chat_page', { page_limit: 100 })
  if (history.error) throw new Error('History failed')
  const message = history.data.find((m) => m.body === prefix + ' ändrat')
  if (
    !(
      await clients[1].rpc('chat_change', {
        message_id: message.id,
        message_body: 'Forbidden',
        expected_version: message.version,
      })
    ).error
  )
    throw new Error('Other sender edit allowed')
  stage = 'unread count, home preview and read cursor'
  await c
    .getByRole('navigation', { name: 'Mobilnavigation' })
    .getByRole('link', { name: 'Hem', exact: true })
    .click()
  await b.getByLabel('Meddelande', { exact: true }).fill(prefix + ' oläst')
  await b.getByRole('button', { name: 'Skicka meddelande' }).click()
  await expect(c.getByText(prefix + ' oläst', { exact: true })).toBeVisible({
    timeout: 20000,
  })
  await expect(
    c
      .getByRole('navigation', { name: 'Mobilnavigation' })
      .getByLabel('1 olästa meddelanden'),
  ).toBeVisible({ timeout: 20000 })
  await c
    .getByRole('navigation', { name: 'Mobilnavigation' })
    .getByRole('link', { name: /Chatt/ })
    .click()
  await expect(
    c
      .getByRole('navigation', { name: 'Mobilnavigation' })
      .getByLabel('1 olästa meddelanden'),
  ).not.toBeVisible({ timeout: 20000 })
  stage = 'simultaneous sends and duplicate retry'
  const request = crypto.randomUUID(),
    request2 = crypto.randomUUID()
  requests.push(request, request2)
  const results = await Promise.all([
    clients[0].rpc('chat_send', {
      message_body: prefix + ' samtidigt A',
      request_id: request,
    }),
    clients[1].rpc('chat_send', {
      message_body: prefix + ' samtidigt B',
      request_id: request2,
    }),
    clients[0].rpc('chat_send', {
      message_body: prefix + ' samtidigt A',
      request_id: request,
    }),
  ])
  if (results.some((r) => r.error)) throw new Error('Concurrent send failed')
  for (const page of pages)
    for (const suffix of ['A', 'B'])
      await expect(
        page
          .locator('.chat-message:not(.pending-message)')
          .filter({ hasText: prefix + ' samtidigt ' + suffix }),
      ).toHaveCount(1, { timeout: 20000 })
  stage = 'offline reconnection'
  await contexts[2].setOffline(true)
  await a
    .getByLabel('Meddelande', { exact: true })
    .fill(prefix + ' återansluten')
  await a.getByRole('button', { name: 'Skicka meddelande' }).click()
  await expect(
    b.getByText(prefix + ' återansluten', { exact: true }),
  ).toBeVisible({ timeout: 20000 })
  await contexts[2].setOffline(false)
  await expect(
    c.getByText(prefix + ' återansluten', { exact: true }),
  ).toBeVisible({ timeout: 30000 })
  await expect(c.getByText('Realtid ansluten', { exact: true })).toBeVisible({
    timeout: 30000,
  })
  stage = 'delete realtime and session reload'
  await a
    .locator('.chat-message')
    .filter({ hasText: prefix + ' ändrat' })
    .getByRole('button', { name: /Radera/ })
    .click()
  await a.getByRole('button', { name: 'Ja, radera' }).click()
  for (const page of pages)
    await expect(
      page.getByText(prefix + ' ändrat', { exact: true }),
    ).not.toBeVisible({ timeout: 20000 })
  await c.reload()
  await expect(
    c.getByText(prefix + ' återansluten', { exact: true }),
  ).toBeVisible({ timeout: 30000 })
  stage = 'anonymous access'
  const anon = createClient(input.projectUrl, input.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  for (const table of [
    'chat_messages',
    'chat_read_states',
    'notification_preferences',
  ])
    if (!(await anon.from(table).select('*')).error)
      throw new Error('Anonymous read allowed')
  for (const [fn, args] of [
    ['chat_page', {}],
    ['chat_summary', {}],
    [
      'chat_send',
      { message_body: 'Forbidden', request_id: crypto.randomUUID() },
    ],
    ['chat_mark_read', { through_seq: 0 }],
    ['chat_preferences', { enabled: false }],
    [
      'chat_change',
      {
        message_id: message.id,
        message_body: 'Forbidden',
        expected_version: 1,
      },
    ],
  ])
    if (!(await anon.rpc(fn, args)).error)
      throw new Error('Anonymous RPC allowed')
  success = true
} catch {
  for (const [index, page] of pages.entries())
    await page
      .screenshot({ path: '/tmp/familjen-chat-debug-' + index + '.png' })
      .catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
  for (const client of clients) await client.removeAllChannels()
  console.log(
    JSON.stringify({ success, stage, requests: [...new Set(requests)] }),
  )
}
