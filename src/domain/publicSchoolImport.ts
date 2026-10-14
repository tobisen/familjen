import { Temporal } from '@js-temporal/polyfill'
import type { PublicSchoolLesson } from './calendar'
export type SchoolImportRow = Omit<PublicSchoolLesson, 'id'>
export interface SchoolDraft {
  period_key?: string
  notes?: string
  date_source?: string
  student_id: string
  source: string
  term_start: string | null
  term_end: string | null
  exception_dates: string[]
  lessons: {
    confirmed?: boolean
    uncertainty?: string
    exception_dates?: string[]
    external_id: string
    weekday: number
    starts_at: string | null
    ends_at: string | null
    subject: string
    room: string | null
  }[]
}
export function isDate(value: unknown): value is string {
  try {
    return (
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Temporal.PlainDate.from(value).toString() === value
    )
  } catch {
    return false
  }
}
const time = (value: unknown): value is string =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
export function parseDraft(input: unknown): SchoolDraft {
  if (!input || typeof input !== 'object')
    throw new Error('Förväntade ett schemaobjekt.')
  const r = input as Record<string, unknown>
  if (
    !['neo', 'sally'].includes(String(r.student_id)) ||
    typeof r.source !== 'string' ||
    !Array.isArray(r.lessons) ||
    r.lessons.length > 1000 ||
    !Array.isArray(r.exception_dates) ||
    !r.exception_dates.every(isDate) ||
    !(r.term_start === null || isDate(r.term_start)) ||
    !(r.term_end === null || isDate(r.term_end))
  )
    throw new Error('Ogiltig elev, källa, datum eller lektionslista.')
  const keys = new Set<string>()
  for (const row of r.lessons) {
    if (
      !row ||
      typeof row !== 'object' ||
      typeof row.external_id !== 'string' ||
      !row.external_id.trim() ||
      row.external_id.length > 200 ||
      keys.has(row.external_id) ||
      !Number.isInteger(row.weekday) ||
      row.weekday < 1 ||
      row.weekday > 7 ||
      typeof row.subject !== 'string' ||
      !row.subject.trim() ||
      row.subject.length > 200 ||
      !(row.room === null || typeof row.room === 'string') ||
      !(row.starts_at === null || time(row.starts_at)) ||
      !(row.ends_at === null || time(row.ends_at))
    )
      throw new Error('Ogiltig lektion eller dubblerat externt ID.')
    if (
      row.exception_dates !== undefined &&
      (!Array.isArray(row.exception_dates) ||
        !row.exception_dates.every(isDate))
    )
      throw new Error('Ogiltiga lektionsavvikelser.')
    keys.add(row.external_id)
  }
  if (
    r.period_key !== undefined &&
    (typeof r.period_key !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,60}$/.test(r.period_key))
  )
    throw new Error('Ogiltigt period-ID.')
  for (const row of r.lessons)
    if (row.confirmed !== undefined && typeof row.confirmed !== 'boolean')
      throw new Error('Ogiltig verifieringsmarkering.')
  return input as SchoolDraft
}
export function prepareSchoolImport(
  draft: SchoolDraft,
  start: string,
  end: string | null,
  exceptions: string[],
  confirmed: boolean,
): SchoolImportRow[] {
  if (!confirmed)
    throw new Error('Bekräfta källuppgifter och terminsperiod först.')
  if (
    !isDate(start) ||
    !isDate(end) ||
    (end && end < start) ||
    !exceptions.every(isDate)
  )
    throw new Error('Ange ett giltigt startdatum och giltiga undantagsdatum.')
  if (!draft.lessons.length)
    throw new Error('Schemat saknar verifierade lektioner.')
  const eligible = draft.lessons.filter((l) => !lessonIssues(l).length)
  if (!eligible.length)
    throw new Error(
      'Inga verifierade lektioner med fullständiga tider. Komplettera underlaget.',
    )
  return eligible.map((l) => {
    return {
      ...l,
      student_id: draft.student_id,
      term_start: start,
      term_end: end,
      exception_dates: [
        ...new Set([...exceptions, ...(l.exception_dates ?? [])]),
      ],
      starts_at: l.starts_at!,
      ends_at: l.ends_at!,
    }
  })
}

export function lessonIssues(l: SchoolDraft['lessons'][number]): string[] {
  const issues: string[] = []
  if (!l.starts_at) issues.push('Starttid saknas')
  if (!l.ends_at) issues.push('Sluttid saknas')
  if (l.starts_at && l.ends_at && l.starts_at >= l.ends_at)
    issues.push('Slut måste vara efter start')
  if (l.confirmed === false)
    issues.push('Uppgifterna är preliminära – behöver bekräftas')
  return issues
}

export function exceptionRange(start: string, end: string): string[] {
  if (!isDate(start) || !isDate(end) || end < start)
    throw new Error('Ange ett giltigt datumintervall för ledigheten.')
  const days = Temporal.PlainDate.from(start).until(
    Temporal.PlainDate.from(end),
  ).days
  if (days > 3660) throw new Error('Datumintervallet är för långt.')
  return Array.from({ length: days + 1 }, (_, i) =>
    Temporal.PlainDate.from(start).add({ days: i }).toString(),
  )
}
