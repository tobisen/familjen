import { Temporal } from '@js-temporal/polyfill'
import {
  occurrences,
  toInstant,
  addDays,
  localParts,
  type CalendarActivity,
  type PublicSchoolLesson,
} from '../../../src/domain/calendar.ts'
export interface Reminder {
  family: string
  id: string
  kind: string
  key: string
  title: string
  body: string
  path: string
  expires: string
}
export interface ReminderSnapshot {
  activities: (CalendarActivity & { family_id: string })[]
  lessons: (PublicSchoolLesson & { family_id: string })[]
  tasks: {
    id: string
    family_id: string
    title: string
    deadline: string
    recipients: string[]
  }[]
}
export function planReminders(
  data: ReminderSnapshot,
  now = Temporal.Now.instant().toString(),
): Reminder[] {
  const instant = Temporal.Instant.from(now),
    date = localParts(now).date,
    result: Reminder[] = []
  const recent = (at: string) => {
    const ms =
      instant.epochMilliseconds - Temporal.Instant.from(at).epochMilliseconds
    return ms >= 0 && ms < 5 * 60_000
  }
  for (const source of [
    ...data.activities.map((a) => ({
      family: a.family_id,
      events: occurrences([a], [], addDays(date, -1), addDays(date, 2)),
    })),
    ...data.lessons.map((l) => ({
      family: l.family_id,
      events: occurrences([], [l], addDays(date, -1), addDays(date, 2)),
    })),
  ]) {
    for (const event of source.events) {
      // All-day events start at local midnight; the same 30-minute rule applies.
      const start = event.starts_at
      const due = Temporal.Instant.from(start)
        .subtract({ minutes: 30 })
        .toString()
      if (!recent(due) || Temporal.Instant.compare(instant, start) >= 0)
        continue
      const kind = event.school ? 'school-reminder' : 'activity-reminder'
      result.push({
        family: source.family,
        id: event.activity.id,
        kind,
        key: `${kind}:${event.key}:${start}`,
        title: event.activity.all_day ? 'Heldag i morgon' : 'Om 30 minuter',
        body: event.activity.title,
        path: `/kalender?activity=${event.activity.id}&date=${event.date}`,
        expires: start,
      })
    }
  }
  for (const task of data.tasks) {
    for (const [offset, kind, title] of [
      [0, 'task-due', 'Uppgift ska vara klar idag'],
      [1, 'task-overdue', 'Förfallen uppgift'],
    ] as const) {
      const due = toInstant(addDays(task.deadline, offset), '08:00')
      if (recent(due))
        result.push({
          family: task.family_id,
          id: task.id,
          kind,
          key: `${kind}:${task.id}:${task.deadline}`,
          title,
          body: task.title,
          path: `/listor?tab=todo&task=${task.id}`,
          expires: Temporal.Instant.from(due).add({ hours: 12 }).toString(),
        })
    }
  }
  return result
}
export function safePushEndpoint(value: string): boolean {
  try {
    const u = new URL(value)
    return (
      u.protocol === 'https:' &&
      !u.port &&
      !u.username &&
      !u.password &&
      !u.hash &&
      [
        'fcm.googleapis.com',
        'web.push.apple.com',
        'updates.push.services.mozilla.com',
      ].includes(u.hostname) &&
      u.pathname.length > 1
    )
  } catch {
    return false
  }
}
// Imports above deliberately reuse the same DST/recurrence logic as the calendar.
