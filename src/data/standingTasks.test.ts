// @vitest-environment node
import { beforeAll, afterAll, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { calendarDatabase, calendarRpc } from '../../tests/support/database'
import {
  occurrences,
  toInstant,
  type CalendarActivity,
} from '../domain/calendar'
let db: PGlite
beforeAll(async () => {
  db = await calendarDatabase()
}, 30000)
afterAll(async () => {
  await db.close()
})
const payload = {
  title: 'Städa köket',
  description: '',
  location: '',
  all_day: false,
  starts_at: toInstant('2026-10-19', '17:00'),
  ends_at: toInstant('2026-10-19', '18:00'),
  participant_ids: ['neo', 'sally'],
  category: 'family',
  standing_task: true,
  recurrence: { frequency: 'weekly', interval: 1, until: null },
  exception_dates: [],
}
it('persists weekly tasks and responsibility, respects exceptions and supports unchecking', async () => {
  const id = await calendarRpc(db, 'calendar_save', { payload })
  const snapshot = (await calendarRpc(db, 'calendar_snapshot', {})) as {
    activities: CalendarActivity[]
  }
  const activity = snapshot.activities.find((a) => a.id === id)!
  expect(activity.standing_task).toBe(true)
  expect(activity.participant_ids).toEqual(['neo', 'sally'])
  expect(
    occurrences([activity], [], '2026-10-19', '2026-11-02').map((o) => o.date),
  ).toEqual(['2026-10-19', '2026-10-26'])
  expect(
    occurrences(
      [{ ...activity, exception_dates: ['2026-10-26'] }],
      [],
      '2026-10-26',
      '2026-11-02',
    ),
  ).toEqual([])
  await calendarRpc(db, 'calendar_save', {
    payload: { ...payload, standing_task: false, recurrence: null },
    event_id: id,
    expected_version: 1,
  })
  const updated = (await calendarRpc(db, 'calendar_snapshot', {})) as {
    activities: CalendarActivity[]
  }
  expect(updated.activities.find((a) => a.id === id)?.standing_task).toBe(false)
})
it('rejects standing tasks that do not repeat every week', async () => {
  for (const recurrence of [
    null,
    { frequency: 'daily', interval: 1 },
    { frequency: 'weekly', interval: 2 },
  ]) {
    await expect(
      calendarRpc(db, 'calendar_save', { payload: { ...payload, recurrence } }),
    ).rejects.toThrow(/standing_task_weekly/)
  }
})
