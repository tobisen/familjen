// @vitest-environment node
import { beforeAll, afterAll, it, expect } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  calendarDatabase,
  calendarRpc,
  asCalendarRole,
} from '../../tests/support/database'
let db: PGlite
const input = {
  title: 'Fixture',
  description: '',
  location: '',
  starts_at: '2026-10-13T08:00:00Z',
  ends_at: '2026-10-13T09:00:00Z',
  all_day: false,
  participant_ids: ['tobias', 'neo'],
  category: 'family',
  recurrence: null,
  exception_dates: [],
}
beforeAll(async () => {
  db = await calendarDatabase(false)
}, 30000)
afterAll(async () => db?.close())
it('defaults to disabled and never opens private Phase 0 tables', async () => {
  await expect(calendarRpc(db, 'public_calendar_snapshot', {})).rejects.toThrow(
    /inte aktiverad/,
  )
  for (const t of [
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
  ])
    await expect(
      asCalendarRole(db, 'anon', () => db.query(`select * from public.${t}`)),
    ).rejects.toThrow(/permission denied/)
  await db.exec('update public.open_calendar_settings set enabled=true')
})
it('allows deliberate public calendar CRUD with concurrency protection', async () => {
  const id = await calendarRpc(db, 'public_calendar_save', { payload: input })
  const snapshot = (await calendarRpc(db, 'public_calendar_snapshot', {})) as {
    activities: { title: string; version: number; participant_ids: string[] }[]
  }
  expect(snapshot.activities[0]).toMatchObject({
    title: 'Fixture',
    version: 1,
    participant_ids: ['tobias', 'neo'],
  })
  await calendarRpc(db, 'public_calendar_save', {
    payload: { ...input, title: 'Updated' },
    event_id: id,
    expected_version: 1,
  })
  await expect(
    calendarRpc(db, 'public_calendar_save', {
      payload: input,
      event_id: id,
      expected_version: 1,
    }),
  ).rejects.toThrow(/annan enhet/)
  await expect(
    calendarRpc(db, 'public_calendar_delete', {
      event_id: id,
      expected_version: 1,
    }),
  ).rejects.toThrow(/ändrats/)
  await calendarRpc(db, 'public_calendar_delete', {
    event_id: id,
    expected_version: 2,
  })
  expect(
    (
      (await calendarRpc(db, 'public_calendar_snapshot', {})) as {
        activities: unknown[]
      }
    ).activities,
  ).toHaveLength(0)
})
it('rejects unbounded direct table writes, invalid participants and recurrence', async () => {
  await expect(
    asCalendarRole(db, 'anon', () =>
      db.query('delete from public.open_calendar_events'),
    ),
  ).rejects.toThrow(/permission denied/)
  for (const patch of [
    { participant_ids: ['admin'] },
    { participant_ids: ['neo', 'neo'] },
    { recurrence: { frequency: 'invalid', interval: 1 } },
    { recurrence: { interval: 1 } },
    { ends_at: input.starts_at },
    { exception_dates: ['2026-02-30'] },
    { all_day: true },
  ])
    await expect(
      calendarRpc(db, 'public_calendar_save', {
        payload: { ...input, ...patch },
      }),
    ).rejects.toThrow()
})
it('atomically upserts stable school IDs and rolls back malformed batches', async () => {
  const lesson = {
    student_id: 'neo',
    external_id: 'fixture',
    weekday: 1,
    starts_at: '10:00',
    ends_at: '11:00',
    subject: 'Fixture',
    room: null,
    term_start: '2026-10-01',
    term_end: null,
    exception_dates: [],
  }
  await calendarRpc(db, 'public_calendar_import', { lessons: [lesson] })
  await calendarRpc(db, 'public_calendar_import', {
    lessons: [{ ...lesson, subject: 'Updated' }],
  })
  const snapshot = (await calendarRpc(db, 'public_calendar_snapshot', {})) as {
    lessons: { subject: string }[]
  }
  expect(snapshot.lessons).toHaveLength(1)
  expect(snapshot.lessons[0]!.subject).toBe('Updated')
  await expect(
    calendarRpc(db, 'public_calendar_import', {
      lessons: [
        { ...lesson, external_id: 'new' },
        { ...lesson, external_id: 'invalid', ends_at: null },
      ],
    }),
  ).rejects.toThrow()
  expect(
    (
      (await calendarRpc(db, 'public_calendar_snapshot', {})) as {
        lessons: unknown[]
      }
    ).lessons,
  ).toHaveLength(1)
  await expect(
    calendarRpc(db, 'public_calendar_import', { lessons: [lesson, lesson] }),
  ).rejects.toThrow(/Dubblerade/)
})
it('does not allow anonymous visitors to enable/disable calendar or provision private membership', async () => {
  await expect(
    asCalendarRole(db, 'anon', () =>
      db.query('update public.open_calendar_settings set enabled=false'),
    ),
  ).rejects.toThrow(/permission denied/)
  await expect(
    asCalendarRole(db, 'anon', () =>
      db.query("insert into public.profiles(display_name) values('Denied')"),
    ),
  ).rejects.toThrow(/permission denied/)
})
it('authenticated visitors get the same public calendar without gaining private membership', async () => {
  const result = await asCalendarRole(db, 'authenticated', () =>
    db.query('select public.public_calendar_snapshot() as data'),
  )
  expect(result.rows).toHaveLength(1)
  const privateRows = await asCalendarRole(db, 'authenticated', () =>
    db.query('select * from public.profiles'),
  )
  expect(privateRows.rows).toHaveLength(0)
})
it('disabled calendar blocks public reads and writes again', async () => {
  await db.exec('update public.open_calendar_settings set enabled=false')
  expect(
    (
      await asCalendarRole(db, 'anon', () =>
        db.query('select * from public.open_calendar_events'),
      )
    ).rows,
  ).toHaveLength(0)
  await expect(
    calendarRpc(db, 'public_calendar_save', { payload: input }),
  ).rejects.toThrow(/inte aktiverad/)
})
