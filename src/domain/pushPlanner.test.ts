// @vitest-environment node
import { expect, it } from 'vitest'
import {
  planReminders,
  safePushEndpoint,
} from '../../supabase/functions/_shared/pushPlanner'
import type { CalendarActivity } from './calendar'
const event: CalendarActivity & { family_id: string } = {
  id: 'event',
  family_id: 'family',
  title: 'Fixture',
  description: '',
  location: '',
  starts_at: '2026-10-19T08:00:00Z',
  ends_at: '2026-10-19T09:00:00Z',
  all_day: false,
  participant_ids: ['neo'],
  recurrence: { frequency: 'weekly', interval: 1, until: '2026-11-02' },
  exception_dates: ['2026-10-26'],
  category: 'family',
  version: 1,
  deleted_at: null,
}
const snapshot = { activities: [event], lessons: [], tasks: [] }
it('plans exactly 30 minutes before, in Stockholm, including after DST ends', () => {
  expect(planReminders(snapshot, '2026-10-19T07:30:00Z')).toHaveLength(1)
  expect(planReminders(snapshot, '2026-11-02T08:30:00Z')).toHaveLength(1)
  expect(planReminders(snapshot, '2026-10-19T07:29:59Z')).toHaveLength(0)
  expect(planReminders(snapshot, '2026-10-19T08:00:01Z')).toHaveLength(0)
  expect(planReminders(snapshot, '2026-10-19T07:35:00Z')).toHaveLength(0)
  expect(planReminders(snapshot, '2026-10-26T08:30:00Z')).toHaveLength(0)
  expect(planReminders(snapshot, '2026-11-09T08:30:00Z')).toHaveLength(0)
})
it('uses stable occurrence keys across polling and distinct weekly occurrences', () => {
  const first = planReminders(snapshot, '2026-10-19T07:30:00Z')[0]!
  expect(planReminders(snapshot, '2026-10-19T07:31:00Z')[0]!.key).toBe(
    first.key,
  )
  expect(planReminders(snapshot, '2026-11-02T08:30:00Z')[0]!.key).not.toBe(
    first.key,
  )
})
it('all-day reminders follow the same 30-minute rule before local midnight', () => {
  const data = {
    ...snapshot,
    activities: [
      {
        ...event,
        starts_at: '2026-10-18T22:00:00Z',
        ends_at: '2026-10-19T22:00:00Z',
        all_day: true,
      },
    ],
  }
  expect(planReminders(data, '2026-10-19T06:30:00Z')).toHaveLength(0)
  expect(planReminders(data, '2026-10-18T21:30:00Z')).toHaveLength(1)
})
it('school reminders respect term limits and individual holidays', () => {
  const data = {
    activities: [],
    tasks: [],
    lessons: [
      {
        id: 'school',
        family_id: 'f',
        student_id: 'sally',
        external_id: 'fixture',
        weekday: 1,
        starts_at: '10:00',
        ends_at: '11:00',
        subject: 'Fixture school',
        room: null,
        term_start: '2026-10-19',
        term_end: '2026-11-02',
        exception_dates: ['2026-10-26'],
      },
    ],
  }
  expect(planReminders(data, '2026-10-19T07:30:00Z')[0]!.kind).toBe(
    'school-reminder',
  )
  expect(planReminders(data, '2026-10-12T07:30:00Z')).toHaveLength(0)
  expect(planReminders(data, '2026-10-26T08:30:00Z')).toHaveLength(0)
})
it('task deadlines and overdue notifications each have one distinct daily key and local 08:00', () => {
  const data = {
    activities: [],
    lessons: [],
    tasks: [
      {
        id: 'task',
        family_id: 'f',
        title: 'Fixture',
        deadline: '2026-10-26',
        recipients: ['p'],
      },
    ],
  }
  expect(planReminders(data, '2026-10-26T07:00:00Z')[0]!.kind).toBe('task-due')
  expect(planReminders(data, '2026-10-27T07:00:00Z')[0]!.kind).toBe(
    'task-overdue',
  )
  expect(planReminders(data, '2026-10-28T07:00:00Z')).toHaveLength(0)
})
it('rejects SSRF endpoints, credentials, alternate ports and deceptive suffixes', () => {
  for (const endpoint of [
    'http://fcm.googleapis.com/id',
    'https://127.0.0.1/',
    'https://fcm.googleapis.com.evil.invalid/x',
    'https://fcm.googleapis.com@127.0.0.1/x',
    'https://fcm.googleapis.com:8443/x',
    'https://web.push.apple.com/x#fragment',
    'invalid',
  ])
    expect(safePushEndpoint(endpoint)).toBe(false)
  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/x',
    'https://web.push.apple.com/x',
    'https://updates.push.services.mozilla.com/wpush/v2/x',
  ])
    expect(safePushEndpoint(endpoint)).toBe(true)
})
