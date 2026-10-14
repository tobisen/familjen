import { test, expect, type BrowserContext } from '@playwright/test'
import { calendarDatabase, calendarRpc, testUser } from '../support/database'
import type { PGlite } from '@electric-sql/pglite'
let db: PGlite
const sallyUser = '00000000-0000-0000-0000-000000000012'
function session(user: string) {
  const claims = {
    sub: user,
    role: 'authenticated',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  }
  const access_token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test_signature`
  return {
    access_token,
    refresh_token: 'test_refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: claims.exp,
    user: {
      id: user,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'fixture@example.invalid',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    },
  }
}
async function api(context: BrowserContext, user = testUser) {
  const stored = session(user)
  await context.addInitScript(
    (value) =>
      localStorage.setItem('familjen.supabase.session', JSON.stringify(value)),
    stored,
  )
  await context.route('https://familjen.test.invalid/auth/v1/user', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stored.user),
    }),
  )
  await context.route(
    'https://familjen.test.invalid/rest/v1/rpc/**',
    async (route) => {
      const req = route.request()
      const name = new URL(req.url()).pathname.split('/').at(-1)!
      if (req.method() === 'OPTIONS') {
        await route.fulfill({
          status: 200,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
          },
        })
        return
      }
      try {
        const result = await calendarRpc(
          db,
          name,
          req.postDataJSON() ?? {},
          user,
        )
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(result),
        })
      } catch (e) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            message: e instanceof Error ? e.message : 'RPC error',
            code: 'P0001',
          }),
        })
      }
    },
  )
}
test.beforeEach(async ({ context }) => {
  db = await calendarDatabase()
  await db.exec(
    `insert into auth.users values ('${sallyUser}'); update public.profiles set auth_user_id='${sallyUser}' where profile_key='sally'`,
  )
  await api(context)
})
test.afterEach(async () => db.close())
test('calendar CRUD with participants, views, filter, persistence and deletion confirmation', async ({
  page,
  context,
}) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /Hej Neo/ })).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Mobilnavigation' })
    .getByRole('link', { name: 'Kalender' })
    .click()
  await expect(
    page.getByRole('button', { name: 'Ny aktivitet', exact: true }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Lägg till', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Neo', { exact: true })).toBeChecked()
  await dialog.getByLabel('Titel', { exact: true }).fill('E2E aktivitet')
  await dialog.getByLabel('Tobias', { exact: true }).check()
  await dialog
    .getByLabel('Beskrivning', { exact: true })
    .fill('Test fixture only')
  await dialog.getByRole('button', { name: 'Spara aktivitet' }).click()
  await expect(dialog).not.toBeVisible()
  const event = page.getByRole('button', { name: /E2E aktivitet,/ }).first()
  await expect(event).toBeVisible()
  await page.screenshot({
    path: test.info().outputPath('calendar-week.png'),
    fullPage: true,
  })
  await event.click()
  await expect(page.getByRole('dialog')).toContainText('Test fixture only')
  await page.getByRole('button', { name: 'Redigera', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByLabel('Titel', { exact: true })
    .fill('E2E ändrad')
  await page.getByRole('button', { name: 'Spara aktivitet' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: 'Månad', exact: true }).click()
  await expect(
    page.getByRole('button', { name: /E2E ändrad,/ }).first(),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Dag', exact: true }).click()
  await expect(
    page.getByRole('button', { name: /E2E ändrad,/ }).first(),
  ).toBeVisible()
  await page.getByRole('checkbox', { name: 'Sally', exact: true }).check()
  await expect(page.getByRole('button', { name: /E2E ändrad,/ })).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Sally', exact: true }).uncheck()
  await page.reload()
  await expect(
    page.getByRole('button', { name: /E2E ändrad,/ }).first(),
  ).toBeVisible()
  // Separate browser page/context sees the same persisted SQL data after loading.
  const other = await context.browser()!.newContext({
    ...{ viewport: { width: 390, height: 844 } },
    serviceWorkers: 'block',
  })
  await api(other, sallyUser)
  const second = await other.newPage()
  await second.goto('http://127.0.0.1:4174/familjen/')
  await expect(second.getByRole('heading', { name: /Hej Sally/ })).toBeVisible()
  await second
    .getByRole('navigation', { name: 'Mobilnavigation' })
    .getByRole('link', { name: 'Kalender' })
    .click()
  await expect(
    second.getByRole('button', { name: /E2E ändrad,/ }).first(),
  ).toBeVisible()
  await other.close()
  await page
    .getByRole('button', { name: /E2E ändrad,/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Radera', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText(
    'Vill du radera aktiviteten?',
  )
  await page.getByRole('button', { name: 'Behåll', exact: true }).click()
  await page.getByRole('button', { name: 'Radera', exact: true }).click()
  await page.getByRole('button', { name: 'Ja, radera', exact: true }).click()
  await expect(page.getByRole('button', { name: /E2E ändrad,/ })).toHaveCount(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})
test('school preview, publication confirmation and idempotent import', async ({
  page,
}) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /Hej Neo/ })).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Mobilnavigation' })
    .getByRole('link', { name: 'Kalender' })
    .click()
  await page.getByRole('button', { name: 'Importera schema' }).click()
  const data = {
    student_id: 'sally',
    source: 'E2E fixture',
    term_start: '2026-01-01',
    term_end: '2026-12-20',
    exception_dates: [],
    lessons: [
      {
        external_id: 'fixture',
        weekday: 1,
        starts_at: '10:00',
        ends_at: '11:00',
        subject: 'Fixture lesson',
        room: null,
      },
    ],
  }
  await page.getByLabel('JSON-fil').setInputFiles({
    name: 'fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  })
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Fixture lesson')
  await expect(
    dialog.getByRole('button', { name: 'Importera schema', exact: true }),
  ).toBeDisabled()
  await dialog.getByRole('checkbox', { name: /Jag har kontrollerat/ }).check()
  await dialog
    .getByRole('button', { name: 'Importera schema', exact: true })
    .click()
  await expect(dialog.getByRole('status')).toContainText(
    '1 lektioner importerades',
  )
  await expect(dialog).toContainText('1 uppdateras')
  await dialog.getByRole('checkbox', { name: /Jag har kontrollerat/ }).check()
  await dialog
    .getByRole('button', { name: 'Importera schema', exact: true })
    .click()
  await expect(dialog.getByRole('status')).toContainText(
    '1 lektioner importerades',
  )
  const rows = await db.query('select * from public.private_school_lessons')
  expect(rows.rows).toHaveLength(1)
})

test('empty time slot, heldag recurrence and a single skipped occurrence', async ({
  page,
}) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /Hej Neo/ })).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Mobilnavigation' })
    .getByRole('link', { name: 'Kalender' })
    .click()
  const slot = page
    .getByRole('button', { name: /Ny aktivitet .* 08:00/ })
    .first()
  await expect(slot).toBeEnabled()
  await slot.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Starttid', { exact: true })).toHaveValue(
    '08:00',
  )
  await dialog.getByLabel('Titel', { exact: true }).fill('E2E serie')
  await dialog.getByLabel('Heldag', { exact: true }).check()
  await dialog
    .getByRole('combobox', { name: 'Upprepning', exact: true })
    .selectOption('weekly')
  await dialog.getByRole('button', { name: 'Spara aktivitet' }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: 'E2E serie, heldag' }).click()
  await page.getByRole('button', { name: /Undanta \d{4}-\d{2}-\d{2}/ }).click()
  await expect(
    page.getByRole('button', { name: 'E2E serie, heldag' }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Nästa period' }).click()
  await expect(
    page.getByRole('button', { name: 'E2E serie, heldag' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'E2E serie, heldag' }).click()
  await page.getByRole('button', { name: 'Radera', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText(
    'Radera hela den återkommande serien?',
  )
  await page.getByRole('button', { name: 'Ja, radera', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'E2E serie, heldag' }),
  ).toHaveCount(0)
})

test('school administration partially activates a private draft and displays lessons in every calendar view', async ({
  page,
}) => {
  const { today, addDays } = await import('../../src/domain/calendar')
  const { Temporal } = await import('@js-temporal/polyfill')
  const date = today()
  const data = {
    student_id: 'sally',
    source: 'E2E synthetic school',
    period_key: 'e2e-term',
    term_start: date,
    term_end: addDays(date, 14),
    exception_dates: [],
    lessons: [
      {
        external_id: 'verified',
        weekday: Temporal.PlainDate.from(date).dayOfWeek,
        starts_at: '10:00',
        ends_at: '11:00',
        subject: 'E2E verified lesson',
        room: 'A1',
        confirmed: true,
      },
      {
        external_id: 'incomplete',
        weekday: 1,
        starts_at: '09:00',
        ends_at: null,
        subject: 'E2E incomplete',
        room: null,
        confirmed: false,
        uncertainty: 'End is unknown',
      },
      {
        external_id: 'lunch',
        weekday: Temporal.PlainDate.from(date).dayOfWeek,
        starts_at: '11:00',
        ends_at: '11:30',
        subject: 'Lunch',
        room: null,
        confirmed: true,
      },
    ],
  }
  await calendarRpc(db, 'school_save', { payload: data })
  await page.goto('./#/installningar')
  await expect(
    page.getByRole('heading', { name: 'Inställningar', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Hantera skolscheman' }).click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByLabel('Familjens sparade scheman')
    .selectOption({ label: 'Sally · e2e-term · 0 aktiverade' })
  await expect(dialog).toContainText('2 av 3 poster kan aktiveras')
  await expect(dialog).toContainText('Sluttid saknas')
  await dialog.getByRole('checkbox', { name: /Jag har kontrollerat/ }).check()
  await dialog
    .getByRole('button', { name: 'Importera schema', exact: true })
    .click()
  await expect(dialog.getByRole('status')).toContainText(
    '2 lektioner importerades',
  )
  await expect(dialog.getByRole('status')).toContainText(
    '1 ofullständiga poster väntar',
  )
  await dialog.getByRole('button', { name: 'Stäng', exact: true }).click()
  await page
    .getByRole('navigation', { name: 'Mobilnavigation' })
    .getByRole('link', { name: 'Kalender' })
    .click()
  await expect(
    page.getByRole('button', { name: 'E2E verified lesson, 10:00' }).first(),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'E2E incomplete, 09:00' }),
  ).toHaveCount(0)
  await page.getByLabel('Visa luncher').uncheck()
  await expect(page.getByRole('button', { name: 'Lunch, 11:00' })).toHaveCount(
    0,
  )
  await page.getByLabel('Visa luncher').check()
  await page.getByRole('button', { name: 'Dag', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'E2E verified lesson, 10:00' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Månad', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'E2E verified lesson, 10:00' }).first(),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'E2E verified lesson, 10:00' }).first(),
  ).toBeVisible()
  expect(
    (await db.query('select * from public.private_school_lessons')).rows,
  ).toHaveLength(2)
})

test('school draft correction preserves unknown times and rejects concurrent overwrites', async ({
  page,
}) => {
  const data = {
    student_id: 'neo',
    source: 'E2E preliminary source',
    period_key: 'e2e-incomplete',
    term_start: null,
    term_end: null,
    exception_dates: [],
    lessons: [
      {
        external_id: 'draft',
        weekday: 1,
        starts_at: '08:45',
        ends_at: null,
        subject: 'E2E uncertain lesson',
        room: null,
        confirmed: false,
        uncertainty: 'End time unknown',
      },
    ],
  }
  const saved = (await calendarRpc(db, 'school_save', { payload: data })) as {
    record: { version: number }
  }
  await page.goto('./#/installningar')
  await page.getByRole('button', { name: 'Hantera skolscheman' }).click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByLabel('Familjens sparade scheman')
    .selectOption({ label: 'Neo · e2e-incomplete · 0 aktiverade' })
  await expect(dialog).toContainText(
    'Komplettera bekräftad terminsstart och terminsslut',
  )
  await expect(
    dialog.getByRole('button', { name: 'Importera schema', exact: true }),
  ).toBeDisabled()
  await dialog
    .locator('summary')
    .filter({ hasText: 'E2E uncertain lesson' })
    .click()
  await expect(dialog.getByLabel('Sluttid 1', { exact: true })).toHaveValue('')
  await dialog.getByLabel('Sluttid 1', { exact: true }).fill('09:45')
  await dialog.getByLabel('Lektion 1 verifierad mot källa').check()
  await expect(dialog).toContainText('1 av 1 poster kan aktiveras')
  // A different authenticated device changes the server version while this form is open.
  await calendarRpc(db, 'school_save', {
    payload: { ...data, source: 'New source from another device' },
    expected_version: saved.record.version,
  })
  await dialog
    .getByRole('button', { name: 'Spara utkast', exact: true })
    .click()
  await expect(dialog.getByRole('alert')).toContainText(
    'Schemat ändrades på en annan enhet',
  )
  expect(
    (await db.query('select * from public.private_school_lessons')).rows,
  ).toHaveLength(0)
  await dialog
    .getByRole('button', {
      name: 'Hämta senaste och återställ förhandsgranskningen',
    })
    .click()
  await expect(dialog).toContainText('New source from another device')
  await expect(dialog.getByLabel('Sluttid 1', { exact: true })).toHaveValue('')
})

async function mockPush(
  context: BrowserContext,
  permission: 'default' | 'denied' = 'default',
) {
  await context.addInitScript((initial) => {
    let value: NotificationPermission = initial
    class FakeNotification {
      static get permission() {
        return value
      }
      static async requestPermission() {
        value = 'granted'
        return value
      }
    }
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: FakeNotification,
    })
    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: class {},
    })
    const original = window.matchMedia.bind(window)
    window.matchMedia = (query: string) =>
      query === '(display-mode: standalone)'
        ? { ...original(query), matches: true }
        : original(query)
    let subscription: unknown = null
    const registration = {
      active: {
        postMessage: (_data: unknown, ports: MessagePort[]) =>
          ports[0]!.postMessage({ ready: true }),
      },
      pushManager: {
        getSubscription: async () => subscription,
        subscribe: async (options: PushSubscriptionOptions) => {
          const endpoint =
            'https://fcm.googleapis.com/fcm/send/' + crypto.randomUUID()
          subscription = {
            endpoint,
            options,
            unsubscribe: async () => true,
            toJSON: () => ({
              endpoint,
              keys: { p256dh: 'A'.repeat(87), auth: 'A'.repeat(22) },
            }),
          }
          return subscription
        },
      },
    }
    Object.defineProperty(navigator.serviceWorker, 'ready', {
      configurable: true,
      value: Promise.resolve(registration),
    })
    Object.defineProperty(navigator.serviceWorker, 'getRegistration', {
      configurable: true,
      value: async () => registration,
    })
    Object.defineProperty(window, 'revokeFixturePermission', {
      value: () => {
        value = 'denied'
        window.dispatchEvent(new Event('focus'))
      },
    })
  }, permission)
}
test('push registration is explicit, test notification is queued securely, revoked permission is respected', async ({
  page,
  context,
}) => {
  await mockPush(context)
  await page.goto('./#/installningar')
  await expect(
    page.getByRole('button', { name: 'Aktivera notiser', exact: true }),
  ).toBeVisible()
  expect(
    (await db.query('select * from public.push_subscriptions')).rows,
  ).toHaveLength(0)
  await page
    .getByRole('button', { name: 'Aktivera notiser', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Skicka testnotis' }),
  ).toBeVisible()
  expect(
    (await db.query('select * from public.push_subscriptions')).rows,
  ).toHaveLength(1)
  await page.getByRole('button', { name: 'Skicka testnotis' }).click()
  await expect(page.getByRole('status')).toContainText('Testnotisen är köad')
  expect(
    (await db.query("select * from private.push_jobs where kind='test'")).rows,
  ).toHaveLength(1)
  await page.evaluate(() =>
    (
      window as unknown as { revokeFixturePermission: () => void }
    ).revokeFixturePermission(),
  )
  await expect(
    page.getByRole('button', { name: 'Skicka testnotis' }),
  ).toHaveCount(0)
  await expect(page.getByText('Nekad', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Stäng av notiser/ }),
  ).toHaveCount(0)
})
test('denied push permission gives OS instructions and does not subscribe', async ({
  page,
  context,
}) => {
  await mockPush(context, 'denied')
  await page.goto('./#/installningar')
  await expect(page.getByText('Nekad', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Aktivera notiser', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByText(/Ändra behörigheten|Aviseringar/)).toBeVisible()
  expect(
    (await db.query('select * from public.push_subscriptions')).rows,
  ).toHaveLength(0)
})
test('notification deep links open the right activity and task on a cold start', async ({
  page,
}) => {
  const id = await calendarRpc(db, 'calendar_save', {
    payload: {
      title: 'E2E linked activity',
      description: '',
      location: '',
      starts_at: '2027-01-18T09:00:00Z',
      ends_at: '2027-01-18T10:00:00Z',
      all_day: false,
      participant_ids: ['neo'],
      category: 'family',
      recurrence: null,
      exception_dates: [],
    },
  })
  await page.goto('./#/kalender?activity=' + id)
  await expect(page.getByRole('dialog')).toContainText('E2E linked activity')
  const task = await calendarRpc(db, 'lists_save', {
    kind: 'task',
    payload: {
      title: 'E2E linked task',
      description: '',
      deadline: null,
      priority: 'normal',
      recurrence: null,
      assigned_ids: ['neo'],
      reminder_days: null,
    },
    request_id: crypto.randomUUID(),
  })
  await page.goto('./#/listor?tab=todo&task=' + task)
  await expect(
    page.getByRole('dialog').getByLabel('Titel', { exact: true }),
  ).toHaveValue('E2E linked task')
})
