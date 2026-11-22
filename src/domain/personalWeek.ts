import { Temporal } from '@js-temporal/polyfill'
import { today } from './calendar'

export const categories = [
  'work',
  'training',
  'meal',
  'home',
  'family',
  'social',
  'other',
  'selfCare',
  'recovery',
] as const
export type PersonalCategory = (typeof categories)[number]
export const taskCategories = [...categories, 'economy'] as const
export type PersonalTaskCategory = (typeof taskCategories)[number]
export const categoryLabels: Record<PersonalCategory, string> = {
  work: 'Jobb',
  training: 'Träning',
  meal: 'Mat',
  home: 'Hem',
  family: 'Familj',
  social: 'Socialt',
  other: 'Övrigt',
  selfCare: 'Egenomsorg',
  recovery: 'Återhämtning',
}
export const taskCategoryLabels: Record<PersonalTaskCategory, string> = {
  ...categoryLabels,
  economy: 'Ekonomi',
}
export const summaryLabels = {
  trainingGoal: 'Veckans träning',
  foodPlan: 'Veckans mat',
  socialPlan: 'Kontaktpunkter / socialt',
  recovery: 'Återhämtning',
  economy: 'Ekonomi',
  reflection: 'Reflektion',
} as const
export const weekTypes = {
  barnvecka: 'Barnvecka',
  barnfri: 'Barnfri',
  specialvecka: 'Specialvecka',
} as const
export type Priority = 'low' | 'normal' | 'high'
export const priorityLabels: Record<Priority, string> = {
  low: 'Låg',
  normal: 'Normal',
  high: 'Hög',
}
export interface PersonalItem {
  id?: string
  category: PersonalCategory
  content: string
  done: boolean
}
export interface PersonalTask {
  id?: string
  category: PersonalTaskCategory
  task: string
  done: boolean
}
export interface PersonalDay {
  id?: string
  date: string
  priority: Priority
  items: PersonalItem[]
}
export interface PersonalPlan {
  year: number
  week_number: number
  week_type: keyof typeof weekTypes
  focus: string[]
  weekly_summary: Partial<Record<keyof typeof summaryLabels, string>>
  days: PersonalDay[]
  tasks: PersonalTask[]
}
export interface SavedPersonalWeek extends PersonalPlan {
  id: string
  owner_id: string
  version: number
  updated_at: string
}
export const weekdays = [
  'måndag',
  'tisdag',
  'onsdag',
  'torsdag',
  'fredag',
  'lördag',
  'söndag',
]
export function isoWeek(date = today()) {
  const d = Temporal.PlainDate.from(date)
  return { year: d.yearOfWeek!, week_number: d.weekOfYear! }
}
export function weekDates(year: number, week: number) {
  const jan4 = Temporal.PlainDate.from({ year, month: 1, day: 4 })
  const monday = jan4
    .subtract({ days: jan4.dayOfWeek - 1 })
    .add({ weeks: week - 1 })
  if (monday.yearOfWeek !== year || monday.weekOfYear !== week)
    throw new Error('week_number: ISO-veckan finns inte för angivet år.')
  return Array.from({ length: 7 }, (_, i) => monday.add({ days: i }).toString())
}
export function shiftWeek(year: number, week: number, step: number) {
  return isoWeek(
    Temporal.PlainDate.from(weekDates(year, week)[0]!)
      .add({ weeks: step })
      .toString(),
  )
}
function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`)
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(path, 'ska vara ett objekt.')
  return value as Record<string, unknown>
}
function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    fail(path, `ska vara en lista med högst ${max} poster.`)
  return value
}
function text(value: unknown, path: string, max = 2000, empty = false): string {
  if (
    typeof value !== 'string' ||
    value.trim().length > max ||
    (!empty && !value.trim())
  )
    fail(path, `ange text ${empty ? 'med högst' : 'med 1–'}${max} tecken.`)
  return value.trim()
}
function choice<T extends string>(
  value: unknown,
  options: readonly T[],
  path: string,
): T {
  if (!options.includes(value as T)) fail(path, `välj ${options.join(', ')}.`)
  return value as T
}
function done(value: unknown, path: string) {
  if (value === undefined) return false
  if (typeof value !== 'boolean') fail(path, 'ska vara true eller false.')
  return value
}
function alias(
  row: Record<string, unknown>,
  a: string,
  b: string,
  path: string,
) {
  return aliases(row, [a, b], path)
}
function aliases(row: Record<string, unknown>, keys: string[], path: string) {
  const present = keys.filter((key) => row[key] !== undefined)
  if (present.length > 1) fail(path, `använd endast ett av ${keys.join(', ')}.`)
  return present.length ? row[present[0]!] : undefined
}
function categoryEntries(value: unknown, path: string): unknown[] {
  if (value === undefined || value === null) return []
  if (typeof value === 'string') return value.trim() ? [value] : []
  return list(value, path, 20)
}
function category(value: unknown, path: string): PersonalCategory {
  return choice(value === 'food' ? 'meal' : value, categories, path)
}
/** Strict known fields, unknown metadata is ignored. IDs/ownership never come from import. */
export function validatePersonalPlan(value: unknown): PersonalPlan {
  const root = object(value, 'vecka')
  const nested =
    root.week !== null && typeof root.week === 'object'
      ? object(root.week, 'week')
      : null
  if (
    nested &&
    ['year', 'week_number', 'week_type', 'weekType', 'focus'].some(
      (key) => root[key] !== undefined,
    )
  )
    fail(
      'week',
      'använd antingen ett week-objekt eller veckofält på översta nivån, inte båda.',
    )
  const metadata = nested ?? root
  const yearPath = nested ? 'week.year' : 'year'
  const weekPath = nested ? 'week.weekNumber' : 'week_number'
  const typePath = nested ? 'week.type' : 'week_type'
  const focusPath = nested ? 'week.focus' : 'focus'
  const year = metadata.year
  const week = nested
    ? aliases(nested, ['weekNumber', 'week_number'], weekPath)
    : alias(root, 'week_number', 'week', weekPath)
  if (
    typeof year !== 'number' ||
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100
  )
    fail(yearPath, 'ange ett heltal 2000–2100.')
  if (
    typeof week !== 'number' ||
    !Number.isInteger(week) ||
    week < 1 ||
    week > 53
  )
    fail(weekPath, 'ange ett heltal 1–53.')
  const dates = weekDates(year, week)
  const weekType = choice(
    nested
      ? aliases(nested, ['type', 'week_type', 'weekType'], typePath)
      : alias(root, 'week_type', 'weekType', typePath),
    Object.keys(weekTypes) as (keyof typeof weekTypes)[],
    typePath,
  )
  const focus = list(metadata.focus ?? [], focusPath, 10).map((f, i) =>
    text(f, `${focusPath}[${i}]`, 80),
  )
  const summary = object(
    alias(root, 'weekly_summary', 'weeklySummary', 'weekly_summary') ?? {},
    'weekly_summary',
  )
  const weekly_summary: PersonalPlan['weekly_summary'] = {}
  for (const key of Object.keys(
    summaryLabels,
  ) as (keyof typeof summaryLabels)[])
    if (summary[key] !== undefined)
      weekly_summary[key] = text(
        summary[key],
        `weekly_summary.${key}`,
        3000,
        true,
      )
  const seen = new Set<string>()
  const days = list(root.days ?? [], 'days', 7).map(
    (value, index): PersonalDay => {
      const path = `days[${index}]`
      const row = object(value, path)
      const date = text(row.date, `${path}.date`, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !dates.includes(date))
        fail(
          `${path}.date`,
          'datumet måste vara ett giltigt datum i angiven ISO-vecka.',
        )
      if (seen.has(date)) fail(`${path}.date`, 'datumet förekommer redan.')
      seen.add(date)
      const dayIndex = dates.indexOf(date)
      const weekdayPath = `${path}.${row.day !== undefined ? 'day' : 'weekday'}`
      const weekday = alias(row, 'weekday', 'day', weekdayPath)
      if (
        weekday !== undefined &&
        weekday !== dayIndex + 1 &&
        (typeof weekday !== 'string' ||
          weekday.toLocaleLowerCase('sv') !== weekdays[dayIndex])
      )
        fail(weekdayPath, 'veckodagen stämmer inte med datumet.')
      const priority = choice(
        row.priority ?? 'normal',
        ['low', 'normal', 'high'],
        `${path}.priority`,
      )
      const items = list(row.items ?? [], `${path}.items`, 90).map(
        (v, i): PersonalItem => {
          const item = object(v, `${path}.items[${i}]`)
          return {
            category: category(item.category, `${path}.items[${i}].category`),
            content: text(item.content, `${path}.items[${i}].content`),
            done: done(item.done, `${path}.items[${i}].done`),
          }
        },
      )
      const grouped = object(row.categories ?? {}, `${path}.categories`)
      for (const key of Object.keys(grouped))
        category(key, `${path}.categories.${key}`)
      for (const key of [...categories, 'food'] as const) {
        if (row[key] !== undefined && grouped[key] !== undefined)
          fail(`${path}.${key}`, 'kategorin finns på två ställen.')
        const entries = row[key] ?? grouped[key]
        if (entries === undefined) continue
        for (const [i, entry] of categoryEntries(
          entries,
          `${path}.${key}`,
        ).entries())
          items.push({
            category: category(key, path),
            content: text(entry, `${path}.${key}[${i}]`),
            done: false,
          })
      }
      if (items.length > 90) fail(`${path}.items`, 'högst 90 poster per dag.')
      return { date, priority, items }
    },
  )
  // Always retain seven editable days, even when optional days are omitted.
  const fullDays = dates.map(
    (date) =>
      days.find((d) => d.date === date) ?? {
        date,
        priority: 'normal' as const,
        items: [],
      },
  )
  const taskList =
    aliases(root, ['tasks', 'weeklyTasks', 'weekTasks'], 'tasks') ?? []
  const taskKeys = new Set<string>()
  const tasks = list(taskList, 'tasks', 100).map((v, i): PersonalTask => {
    const row = typeof v === 'string' ? { task: v } : object(v, `tasks[${i}]`)
    const entry = {
      category: choice(
        row.category === 'food' ? 'meal' : (row.category ?? 'other'),
        taskCategories,
        `tasks[${i}].category`,
      ),
      task: text(row.task, `tasks[${i}].task`, 1000),
      done: done(row.done, `tasks[${i}].done`),
    }
    const key = `${entry.category}:${entry.task}`
    if (taskKeys.has(key))
      fail(`tasks[${i}]`, 'uppgiften förekommer redan i kategorin.')
    taskKeys.add(key)
    return entry
  })
  return {
    year,
    week_number: week,
    week_type: weekType,
    focus,
    weekly_summary,
    days: fullDays,
    tasks,
  }
}
export function parsePersonalWeek(raw: string): PersonalPlan {
  if (raw.length > 200000) fail('JSON', 'högst 200 000 tecken.')
  const input = raw
    .trim()
    .replace(/^--- FAMILJEN WEEK IMPORT ---\s*([\s\S]*?)\s*--- END ---$/, '$1')
  let value: unknown
  try {
    value = JSON.parse(input)
  } catch {
    fail(
      'JSON',
      'kunde inte läsas. Kontrollera citattecken, kommatecken och importmarkörer.',
    )
  }
  return validatePersonalPlan(value)
}
