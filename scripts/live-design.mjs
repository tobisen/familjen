// Isolated hosted verification. Sessions arrive on stdin and are never logged.
import { chromium, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
let raw = ''
for await (const chunk of process.stdin) raw += chunk
const input = JSON.parse(raw)
raw = ''
const browser = await chromium.launch()
const contexts = [],
  pages = [],
  clients = []
let stage = 'session restore',
  success = false
try {
  for (const person of ['tobias', 'neo', 'sally']) {
    const context = await browser.newContext({
      viewport: { width: 393, height: 851 },
      serviceWorkers: 'block',
    })
    contexts.push(context)
    await context.addInitScript(
      (s) =>
        localStorage.setItem('familjen.supabase.session', JSON.stringify(s)),
      input.sessions[person],
    )
    const page = await context.newPage()
    pages.push(page)
    await page.goto(input.baseUrl + '#/chatt')
    await expect(
      page.getByText('Realtid ansluten', { exact: true }),
    ).toBeVisible({ timeout: 30000 })
    const client = createClient(input.projectUrl, input.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    await client.auth.setSession(input.sessions[person])
    clients.push(client)
  }
  stage = 'three-session send and unread'
  await pages[2]
    .getByRole('navigation', { name: 'Huvudnavigation' })
    .getByRole('link', { name: 'Kalender', exact: true })
    .click()
  await pages[1]
    .getByLabel('Meddelande', { exact: true })
    .fill('Isolated design verification 👋')
  await pages[1].getByRole('button', { name: 'Skicka meddelande' }).click()
  for (const p of pages.slice(0, 2))
    await expect(p.locator('.message-body')).toHaveText(
      'Isolated design verification 👋',
      { timeout: 20000 },
    )
  await expect(
    pages[2]
      .getByRole('navigation', { name: 'Huvudnavigation' })
      .getByLabel('1 olästa meddelanden'),
  ).toBeVisible({ timeout: 20000 })
  const { data: rows, error } = await clients[1].rpc('chat_page')
  if (error) throw error
  const id = rows[0].id
  stage = 'RLS owner restriction'
  const denied = await clients[0].rpc('chat_change', {
    message_id: id,
    message_body: 'Forbidden',
    expected_version: 1,
    remove_message: true,
  })
  if (!denied.error) throw Error('Foreign deletion permitted')
  stage = 'realtime deletion and unread reset'
  await pages[1].getByRole('button', { name: /Radera meddelande/ }).click()
  await pages[1].getByRole('button', { name: 'Ja, radera' }).click()
  for (const p of pages.slice(0, 2))
    await expect(p.locator('.chat-message')).toHaveCount(0, { timeout: 20000 })
  await expect(
    pages[2]
      .getByRole('navigation', { name: 'Huvudnavigation' })
      .getByLabel('1 olästa meddelanden'),
  ).toHaveCount(0, { timeout: 20000 })
  for (const client of clients) {
    const { data, error } = await client
      .from('chat_messages')
      .select('*')
      .eq('id', id)
    if (error || data.length) throw Error('Deleted content returned')
  }
  stage = 'reconnect after missed deletion'
  await pages[0]
    .getByLabel('Meddelande', { exact: true })
    .fill('Deleted while disconnected')
  await pages[0].getByRole('button', { name: 'Skicka meddelande' }).click()
  await expect(pages[1].locator('.chat-message')).toHaveCount(1, {
    timeout: 20000,
  })
  await contexts[1].setOffline(true)
  await pages[0].getByRole('button', { name: /Radera meddelande/ }).click()
  await pages[0].getByRole('button', { name: 'Ja, radera' }).click()
  await expect(pages[0].locator('.chat-message')).toHaveCount(0)
  await contexts[1].setOffline(false)
  await expect(pages[1].locator('.chat-message')).toHaveCount(0, {
    timeout: 30000,
  })
  stage = 'profile lock and layout'
  for (const [i, p] of pages.entries()) {
    await p.goto(input.baseUrl + '#/installningar')
    await expect(p.locator('.locked-profile')).toContainText(
      ['Tobias', 'Neo', 'Sally'][i],
    )
    await p.evaluate(() => localStorage.setItem('familjen.profile', 'sally'))
    await p.reload()
    await expect(p.locator('.locked-profile')).toContainText(
      ['Tobias', 'Neo', 'Sally'][i],
    )
    if (
      !(await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ))
    )
      throw Error('Horizontal overflow')
  }
  success = true
} catch {
  process.exitCode = 1
} finally {
  for (const c of clients) await c.auth.signOut({ scope: 'local' })
  await browser.close()
  console.log(
    JSON.stringify({ success, stage, sessions: 3, physicalDevice: false }),
  )
}
