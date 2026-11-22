import { describe, expect, it } from 'vitest'
import {
  parsePersonalWeek,
  validatePersonalPlan,
  isoWeek,
  weekDates,
  shiftWeek,
} from './personalWeek'
const base = { year: 2026, week: 48, weekType: 'barnvecka' }
describe('personal JSON import', () => {
  it('accepts plain JSON, marked blocks, omitted fields and empty categories', () => {
    for (const raw of [
      JSON.stringify(base),
      `--- FAMILJEN WEEK IMPORT ---\n${JSON.stringify(base)}\n--- END ---`,
    ]) {
      const plan = parsePersonalWeek(raw)
      expect(plan.days).toHaveLength(7)
      expect(plan.days[0]!.date).toBe('2026-11-23')
      expect(plan.tasks).toEqual([])
      expect(plan.weekly_summary).toEqual({})
    }
    expect(
      validatePersonalPlan({
        ...base,
        days: [{ date: '2026-11-23', food: [], training: [] }],
      }).days[0]!.items,
    ).toEqual([])
  })
  it('maps legacy categories, summary and tasks while ignoring unknown metadata and imported identities', () => {
    const plan = validatePersonalPlan({
      ...base,
      owner_id: 'forged',
      extra: 'metadata',
      focus: ['Hälsa'],
      weeklySummary: { trainingGoal: 'Två pass', extra: 'ignored' },
      days: [
        {
          date: '2026-11-23',
          weekday: 'Måndag',
          food: ['Lunch'],
          training: ['Promenad'],
          home: [],
          family: ['Middag'],
          items: [{ category: 'selfCare', content: 'Läsa' }],
        },
      ],
      weeklyTasks: [{ task: 'Boka tid', category: 'food' }],
    })
    expect(plan.days[0]!.items.map((i) => i.category)).toEqual([
      'selfCare',
      'training',
      'family',
      'meal',
    ])
    expect(plan.tasks[0]).toEqual({
      task: 'Boka tid',
      category: 'meal',
      done: false,
    })
    expect(plan.weekly_summary).toEqual({ trainingGoal: 'Två pass' })
    expect(plan).not.toHaveProperty('owner_id')
  })
  it.each([
    [{ days: [{ date: '2026-11-31' }] }, 'days[0].date'],
    [{ days: [{ date: '2026-11-22' }] }, 'days[0].date'],
    [{ days: [{ date: '2026-11-23', weekday: 2 }] }, 'weekday'],
    [{ days: [{ date: '2026-11-23', priority: 'urgent' }] }, 'priority'],
    [
      {
        days: [
          { date: '2026-11-23', items: [{ category: 'bad', content: 'x' }] },
        ],
      },
      'category',
    ],
    [
      { days: [{ date: '2026-11-23', categories: { bad: [] } }] },
      'categories.bad',
    ],
    [{ days: [{ date: '2026-11-23' }, { date: '2026-11-23' }] }, 'date'],
    [{ tasks: ['x', 'x'] }, 'tasks[1]'],
    [{ weeklySummary: { economy: 42 } }, 'economy'],
    [{ focus: ['x'.repeat(81)] }, 'focus[0]'],
    [{ tasks: [{ task: 'x', done: 'false' }] }, 'done'],
    [{ days: [{ date: '2026-11-23', food: 'Lunch' }] }, 'food'],
    [{ week_type: 'barnfri' }, 'week_type'],
    [{ year: 2026.5 }, 'year'],
  ])('rejects invalid known fields with a field path (%j)', (change, field) => {
    expect(() => validatePersonalPlan({ ...base, ...change })).toThrow(field)
  })
  it('bounds payload size and rejects malformed JSON and markers', () => {
    expect(() => parsePersonalWeek('x'.repeat(200001))).toThrow('200 000')
    expect(() => parsePersonalWeek('{')).toThrow('JSON')
    expect(() =>
      parsePersonalWeek(
        `--- FAMILJEN WEEK IMPORT ---\n${JSON.stringify(base)}`,
      ),
    ).toThrow('JSON')
  })
  it('validates ISO year boundaries and navigation including week 53', () => {
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week_number: 53 })
    expect(weekDates(2026, 53)).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ])
    expect(shiftWeek(2026, 53, 1)).toEqual({ year: 2027, week_number: 1 })
    expect(shiftWeek(2027, 1, -1)).toEqual({ year: 2026, week_number: 53 })
    expect(() => weekDates(2025, 53)).toThrow('ISO')
    expect(
      validatePersonalPlan({
        year: 2026,
        week_number: 53,
        week_type: 'barnfri',
        days: [{ date: '2027-01-01', weekday: 5 }],
      }).days[4]!.date,
    ).toBe('2027-01-01')
  })
})
