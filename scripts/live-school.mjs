// Operator-only verification. Auth sessions arrive through stdin and stay in memory.
// Synthetic rows are reported by exact UUID for cleanup by the trusted runner.
import { chromium, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { Temporal } from '@js-temporal/polyfill'
let raw = ''
for await (const chunk of process.stdin) raw += chunk
const input = JSON.parse(raw)
raw = ''
const browser = await chromium.launch()
const contexts = [],
  clients = [],
  pages = []
let recordId = null,
  lessonIds = [],
  success = false,
  stage = 'registration'
try {
  for (const person of ['tobias', 'neo', 'sally']) {
    const context = await browser.newContext({
      viewport: { width: 393, height: 851 },
      serviceWorkers: 'block',
    })
    contexts.push(context)
    await context.addInitScript(
      (session) =>
        localStorage.setItem(
          'familjen.supabase.session',
          JSON.stringify(session),
        ),
      input.sessions[person],
    )
    const page = await context.newPage()
    pages.push(page)
    await page.goto(input.baseUrl + '#/kalender')
    await expect(
      page.getByText('Realtid ansluten', { exact: false }),
    ).toBeVisible({ timeout: 30000 })
    const client = createClient(input.projectUrl, input.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    await client.auth.setSession(input.sessions[person])
    clients.push(client)
  }
  stage = 'real private drafts shared by all three identities'
  for (const client of clients) {
    const { data, error } = await client.rpc('school_snapshot')
    if (error) throw new Error('Private school snapshot failed')
    if (
      !data.some(
        (r) => r.student_id === 'sally' && r.draft.lessons.length === 24,
      ) ||
      !data.some((r) => r.student_id === 'neo' && r.draft.lessons.length === 18)
    )
      throw new Error('Real private drafts missing')
  }
  const date = Temporal.Now.plainDateISO('Europe/Stockholm')
  const payload = {
    student_id: 'sally',
    period_key: 'verify-' + crypto.randomUUID(),
    source: 'Automated verification only',
    term_start: date.toString(),
    term_end: date.add({ days: 7 }).toString(),
    exception_dates: [],
    lessons: [
      {
        external_id: 'complete',
        weekday: date.dayOfWeek,
        starts_at: '10:00',
        ends_at: '11:00',
        subject: 'Verifiering skola ' + crypto.randomUUID().slice(0, 8),
        room: null,
        confirmed: true,
      },
      {
        external_id: 'incomplete',
        weekday: 1,
        starts_at: '09:00',
        ends_at: null,
        subject: 'Verifiering ofullständig',
        room: null,
        confirmed: false,
      },
    ],
  }
  const save = async (version, activate) => {
    const { data, error } = await clients[0].rpc('school_save', {
      payload,
      expected_version: version,
      activate,
      replace_missing: true,
    })
    if (error) throw new Error('School save failed')
    recordId = data.record.id
    return data
  }
  stage = 'private draft then partial activation via authenticated RPC'
  const draft = await save(null, false)
  const active = await save(draft.record.version, true)
  if (active.count !== 1) throw new Error('Partial activation failed')
  const snapshot = await clients[0].rpc('calendar_snapshot')
  lessonIds = snapshot.data.lessons
    .filter((l) =>
      l.external_id.startsWith('period:' + payload.period_key + ':'),
    )
    .map((l) => l.id)
  if (lessonIds.length !== 1) throw new Error('Unexpected lesson count')
  stage = 'three-way realtime calendar delivery'
  for (const page of pages)
    await expect(
      page
        .getByRole('button', { name: payload.lessons[0].subject + ', 10:00' })
        .first(),
    ).toBeVisible({ timeout: 30000 })
  await contexts[1].setOffline(true)
  payload.lessons[0].subject += ' ändrad'
  const updated = await save(active.record.version, true)
  for (const page of [pages[0], pages[2]])
    await expect(
      page
        .getByRole('button', { name: payload.lessons[0].subject + ', 10:00' })
        .first(),
    ).toBeVisible({ timeout: 30000 })
  stage = 'reconnection and stable lesson ID'
  await contexts[1].setOffline(false)
  await expect(
    pages[1]
      .getByRole('button', { name: payload.lessons[0].subject + ', 10:00' })
      .first(),
  ).toBeVisible({ timeout: 30000 })
  await save(updated.record.version, true)
  for (const client of clients) {
    const { data } = await client.rpc('calendar_snapshot')
    const ids = data.lessons
      .filter((l) =>
        l.external_id.startsWith('period:' + payload.period_key + ':'),
      )
      .map((l) => l.id)
    if (JSON.stringify(ids) !== JSON.stringify(lessonIds))
      throw new Error('Duplicate or identity mismatch')
  }
  stage = 'anonymous access denied'
  const anon = createClient(input.projectUrl, input.publishableKey, {
    auth: { persistSession: false },
  })
  if (
    !(await anon.rpc('school_snapshot')).error ||
    !(await anon.rpc('school_save', { payload })).error
  )
    throw new Error('Anonymous RPC unexpectedly allowed')
  success = true
} catch {
  process.exitCode = 1
} finally {
  for (const client of clients) await client.auth.signOut({ scope: 'local' })
  await browser.close()
  console.log(
    JSON.stringify({
      success,
      stage,
      recordId,
      lessonIds,
      threeIdentities: true,
    }),
  )
}
