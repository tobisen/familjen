import type { SchoolLesson } from './models'
const date = (s: unknown): s is string =>
  typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s
const time = (s: unknown): s is string =>
  typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
export function parseSchoolImport(input: unknown): SchoolLesson[] {
  if (!Array.isArray(input))
    throw new Error('Schemat måste vara en JSON-array.')
  const keys = new Set<string>()
  return input.map((row: unknown) => {
    if (!row || typeof row !== 'object') throw new Error('Ogiltig lektion.')
    const r = row as Record<string, unknown>
    if (
      typeof r.external_id !== 'string' ||
      !r.external_id.trim() ||
      typeof r.student_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        r.student_id,
      ) ||
      !Number.isInteger(r.weekday) ||
      Number(r.weekday) < 1 ||
      Number(r.weekday) > 7 ||
      !time(r.starts_at) ||
      !time(r.ends_at) ||
      r.starts_at >= r.ends_at ||
      typeof r.subject !== 'string' ||
      !r.subject.trim() ||
      !(r.room === null || typeof r.room === 'string') ||
      !date(r.term_start) ||
      !date(r.term_end) ||
      r.term_start > r.term_end ||
      !Array.isArray(r.exception_dates) ||
      !r.exception_dates.every(date)
    )
      throw new Error('Lektionens fält eller tider är ogiltiga.')
    const key = `${r.student_id}:${r.external_id}`
    if (keys.has(key))
      throw new Error('Dubblerat externt lektions-ID för eleven.')
    keys.add(key)
    return r as unknown as SchoolLesson
  })
}
