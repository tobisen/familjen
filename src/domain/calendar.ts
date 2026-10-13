import { Temporal } from '@js-temporal/polyfill'
export const ZONE = 'Europe/Stockholm'
export interface CalendarPerson {
  id: string
  display_name: string
  color: 'blue' | 'green' | 'orange'
}
export interface Recurrence {
  frequency: 'daily' | 'weekly' | 'monthly'
  interval: number
  until: string | null
}
export interface CalendarActivity {
  id: string
  title: string
  description: string
  location: string
  starts_at: string
  ends_at: string
  all_day: boolean
  participant_ids: string[]
  recurrence: Recurrence | null
  exception_dates: string[]
  category: 'family' | 'school'
  version: number
  deleted_at: string | null
}
export type ActivityInput = Omit<
  CalendarActivity,
  'id' | 'version' | 'deleted_at'
>
export interface Occurrence {
  key: string
  activity: CalendarActivity
  date: string
  starts_at: string
  ends_at: string
  school?: boolean
}
export interface PublicSchoolLesson {
  id: string
  student_id: string
  external_id: string
  weekday: number
  starts_at: string
  ends_at: string
  subject: string
  room: string | null
  term_start: string
  term_end: string | null
  exception_dates: string[]
}
export const today = () => Temporal.Now.plainDateISO(ZONE).toString()
export const addDays = (date: string, days: number) =>
  Temporal.PlainDate.from(date).add({ days }).toString()
export function localParts(instant: string) {
  const z = Temporal.Instant.from(instant).toZonedDateTimeISO(ZONE)
  return {
    date: z.toPlainDate().toString(),
    time: z.toPlainTime().toString({ smallestUnit: 'minute' }),
  }
}
export function toInstant(
  date: string,
  time: string,
  disambiguation: 'reject' | 'earlier' | 'later' = 'reject',
) {
  const z = Temporal.ZonedDateTime.from(`${date}T${time}[${ZONE}]`, {
    disambiguation,
  })
  if (
    z.toPlainDate().toString() !== date ||
    !z.toPlainTime().equals(Temporal.PlainTime.from(time))
  )
    throw new RangeError('Tiden finns inte vid vårens tidsomställning.')
  return z.toInstant().toString()
}
export function dateLabel(
  date: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' },
) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: ZONE,
    ...options,
  }).format(new Date(toInstant(date, '12:00')))
}
export const timeLabel = (instant: string) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: ZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(instant))
export function weekStart(date: string) {
  const d = Temporal.PlainDate.from(date)
  return d.subtract({ days: d.dayOfWeek - 1 }).toString()
}
export function monthGrid(date: string) {
  const d = Temporal.PlainDate.from(date).with({ day: 1 })
  const first = weekStart(d.toString())
  return Array.from({ length: 42 }, (_, i) => addDays(first, i))
}
export function validateActivity(a: ActivityInput) {
  if (
    !a.title.trim() ||
    a.title.length > 200 ||
    a.description.length > 10000 ||
    a.location.length > 500
  )
    throw new Error(
      'Ange en titel (högst 200 tecken). Beskrivning och plats måste vara rimligt långa.',
    )
  if (Temporal.Instant.compare(a.starts_at, a.ends_at) >= 0)
    throw new Error('Slutet måste vara efter starten.')
  if (
    !a.participant_ids.length ||
    new Set(a.participant_ids).size !== a.participant_ids.length ||
    !a.participant_ids.every((id) => ['tobias', 'neo', 'sally'].includes(id))
  )
    throw new Error('Välj minst en giltig deltagare, utan dubbletter.')
  if (!['family', 'school'].includes(a.category))
    throw new Error('Ogiltig kategori.')
  for (const d of a.exception_dates) Temporal.PlainDate.from(d)
  if (a.recurrence) {
    const r = a.recurrence
    if (
      !['daily', 'weekly', 'monthly'].includes(r.frequency) ||
      !Number.isInteger(r.interval) ||
      r.interval < 1 ||
      r.interval > 52
    )
      throw new Error('Ogiltigt upprepningsintervall.')
    if (
      r.until &&
      Temporal.PlainDate.compare(r.until, localParts(a.starts_at).date) < 0
    )
      throw new Error('Upprepningens slutdatum ligger före starten.')
  }
  if (
    a.all_day &&
    (localParts(a.starts_at).time !== '00:00' ||
      localParts(a.ends_at).time !== '00:00')
  )
    throw new Error('Heldagsaktiviteter ska börja och sluta vid midnatt.')
}
export function visibleTo(
  a: Pick<CalendarActivity, 'participant_ids' | 'category'>,
  persons: string[],
  category = 'all',
) {
  return (
    (persons.length === 0 ||
      persons.some((p) => a.participant_ids.includes(p))) &&
    (category === 'all' || a.category === category)
  )
}
function recurringInstant(date: Temporal.PlainDate, time: string) {
  // Earlier occurrence in the repeated autumn hour; skip nonexistent spring time.
  const z = Temporal.ZonedDateTime.from(`${date}T${time}[${ZONE}]`, {
    disambiguation: 'compatible',
  })
  if (!z.toPlainTime().equals(Temporal.PlainTime.from(time))) return null
  return z.toInstant().toString()
}
export function expandActivity(
  activity: CalendarActivity,
  from: string,
  to: string,
): Occurrence[] {
  if (activity.deleted_at) return []
  const rangeStart = Temporal.Instant.from(toInstant(from, '00:00'))
  const rangeEnd = Temporal.Instant.from(toInstant(to, '00:00'))
  const start = Temporal.Instant.from(activity.starts_at).toZonedDateTimeISO(
    ZONE,
  )
  const end = Temporal.Instant.from(activity.ends_at).toZonedDateTimeISO(ZONE)
  const seed = start.toPlainDate()
  const dayOffset = seed.until(end.toPlainDate()).days
  const duration = end.epochMilliseconds - start.epochMilliseconds
  const output: Occurrence[] = []
  const append = (date: string, s: string, e: string) => {
    if (
      !activity.exception_dates.includes(date) &&
      Temporal.Instant.compare(s, rangeEnd) < 0 &&
      Temporal.Instant.compare(e, rangeStart) > 0
    )
      output.push({
        key: `${activity.id}:${date}`,
        activity,
        date,
        starts_at: s,
        ends_at: e,
      })
  }
  if (!activity.recurrence) {
    append(seed.toString(), activity.starts_at, activity.ends_at)
    return output
  }
  const r = activity.recurrence
  // Jump near the visible range so old infinite series do not require unbounded iteration.
  const fromDate = Temporal.PlainDate.from(from).subtract({
    days: Math.max(dayOffset, 1),
  })
  let first = 0
  if (Temporal.PlainDate.compare(fromDate, seed) > 0) {
    const days = seed.until(fromDate).days
    first =
      r.frequency === 'monthly'
        ? Math.max(
            0,
            Math.floor(
              seed.until(fromDate, { largestUnit: 'months' }).months /
                r.interval,
            ) - 1,
          )
        : Math.max(
            0,
            Math.floor(
              days / (r.interval * (r.frequency === 'weekly' ? 7 : 1)),
            ) - 1,
          )
  }
  for (let i = first; i < first + 5000; i++) {
    let date: Temporal.PlainDate
    try {
      date = seed.add(
        r.frequency === 'monthly'
          ? { months: i * r.interval }
          : { days: i * r.interval * (r.frequency === 'weekly' ? 7 : 1) },
        { overflow: 'reject' },
      )
    } catch {
      continue
    }
    const ds = date.toString()
    if (ds >= to || (r.until && ds > r.until)) break
    const s = recurringInstant(date, start.toPlainTime().toString())
    let e = recurringInstant(
      date.add({ days: dayOffset }),
      end.toPlainTime().toString(),
    )
    if (!s || !e) continue
    // If a repeated autumn hour would otherwise invert a short occurrence, preserve elapsed duration.
    if (Temporal.Instant.compare(e, s) <= 0)
      e = Temporal.Instant.from(s).add({ milliseconds: duration }).toString()
    append(ds, s, e)
  }
  return output
}
export function expandSchool(
  lesson: PublicSchoolLesson,
  from: string,
  to: string,
): Occurrence[] {
  const output: Occurrence[] = []
  for (let date = from; date < to; date = addDays(date, 1)) {
    if (
      date < lesson.term_start ||
      (lesson.term_end && date > lesson.term_end) ||
      lesson.exception_dates.includes(date) ||
      Temporal.PlainDate.from(date).dayOfWeek !== lesson.weekday
    )
      continue
    const s = recurringInstant(Temporal.PlainDate.from(date), lesson.starts_at)
    const e = recurringInstant(Temporal.PlainDate.from(date), lesson.ends_at)
    if (!s || !e) continue
    const activity: CalendarActivity = {
      id: lesson.id,
      title: lesson.subject,
      description: 'Importerat skolschema',
      location: lesson.room ?? '',
      starts_at: s,
      ends_at: e,
      all_day: false,
      participant_ids: [lesson.student_id],
      recurrence: null,
      exception_dates: lesson.exception_dates,
      category: 'school',
      version: 1,
      deleted_at: null,
    }
    output.push({
      key: `school:${lesson.id}:${date}`,
      activity,
      date,
      starts_at: s,
      ends_at: e,
      school: true,
    })
  }
  return output
}
export function occurrences(
  activities: CalendarActivity[],
  lessons: PublicSchoolLesson[],
  from: string,
  to: string,
  persons: string[] = [],
  category = 'all',
) {
  return [
    ...activities
      .filter((a) => visibleTo(a, persons, category))
      .flatMap((a) => expandActivity(a, from, to)),
    ...lessons
      .filter((l) =>
        visibleTo(
          { participant_ids: [l.student_id], category: 'school' },
          persons,
          category,
        ),
      )
      .flatMap((l) => expandSchool(l, from, to)),
  ].sort(
    (a, b) =>
      Temporal.Instant.compare(a.starts_at, b.starts_at) ||
      a.activity.title.localeCompare(b.activity.title),
  )
}
export function onDay(o: Occurrence, date: string) {
  return (
    Temporal.Instant.compare(
      o.starts_at,
      toInstant(addDays(date, 1), '00:00'),
    ) < 0 && Temporal.Instant.compare(o.ends_at, toInstant(date, '00:00')) > 0
  )
}
