import { describe, it, expect } from 'vitest'
import {
  toInstant,
  localParts,
  expandActivity,
  expandSchool,
  visibleTo,
  weekStart,
  monthGrid,
  validateActivity,
  onDay,
  type CalendarActivity,
} from './calendar'
const base: CalendarActivity = {
  id: 'test',
  title: 'Fixture',
  description: '',
  location: '',
  starts_at: toInstant('2026-03-22', '10:00'),
  ends_at: toInstant('2026-03-22', '11:00'),
  all_day: false,
  participant_ids: ['tobias', 'neo'],
  recurrence: { frequency: 'weekly', interval: 1, until: null },
  exception_dates: [],
  category: 'family',
  version: 1,
  deleted_at: null,
}
describe('Stockholm time and recurrence', () => {
  it('preserves local hour across spring DST', () => {
    const rows = expandActivity(base, '2026-03-22', '2026-04-06')
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => localParts(r.starts_at).time)).toEqual([
      '10:00',
      '10:00',
      '10:00',
    ])
    expect(rows[0]!.starts_at).toContain('09:00')
    expect(rows[1]!.starts_at).toContain('08:00')
  })
  it('preserves local hour across autumn DST', () => {
    const rows = expandActivity(
      {
        ...base,
        starts_at: toInstant('2026-10-18', '10:00'),
        ends_at: toInstant('2026-10-18', '11:00'),
      },
      '2026-10-18',
      '2026-11-02',
    )
    expect(rows.map((r) => localParts(r.starts_at).time)).toEqual([
      '10:00',
      '10:00',
      '10:00',
    ])
    expect(rows[0]!.starts_at).toContain('08:00')
    expect(rows[1]!.starts_at).toContain('09:00')
  })
  it('rejects nonexistent spring hour even if earlier/later requested', () => {
    for (const choice of ['reject', 'earlier', 'later'] as const)
      expect(() => toInstant('2026-03-29', '02:30', choice)).toThrow()
  })
  it('requires a choice for the repeated autumn hour', () => {
    expect(() => toInstant('2026-10-25', '02:30')).toThrow()
    expect(toInstant('2026-10-25', '02:30', 'earlier')).toBe(
      '2026-10-25T00:30:00Z',
    )
    expect(toInstant('2026-10-25', '02:30', 'later')).toBe(
      '2026-10-25T01:30:00Z',
    )
  })
  it('skips nonexistent recurrence instances', () => {
    const rows = expandActivity(
      {
        ...base,
        starts_at: toInstant('2026-03-22', '02:30'),
        ends_at: toInstant('2026-03-22', '03:30'),
      },
      '2026-03-22',
      '2026-04-06',
    )
    expect(rows.map((r) => r.date)).toEqual(['2026-03-22', '2026-04-05'])
  })
  it('uses inclusive until and exception dates', () => {
    const rows = expandActivity(
      {
        ...base,
        recurrence: { frequency: 'weekly', interval: 1, until: '2026-04-05' },
        exception_dates: ['2026-03-29'],
      },
      '2026-03-01',
      '2026-05-01',
    )
    expect(rows.map((r) => r.date)).toEqual(['2026-03-22', '2026-04-05'])
  })
  it('supports daily intervals', () =>
    expect(
      expandActivity(
        {
          ...base,
          recurrence: { frequency: 'daily', interval: 2, until: null },
        },
        '2026-03-22',
        '2026-03-27',
      ).map((o) => o.date),
    ).toEqual(['2026-03-22', '2026-03-24', '2026-03-26']))
  it('skips invalid monthly dates without drifting the series', () => {
    const a = {
      ...base,
      starts_at: toInstant('2026-01-31', '10:00'),
      ends_at: toInstant('2026-01-31', '11:00'),
      recurrence: { frequency: 'monthly' as const, interval: 1, until: null },
    }
    expect(
      expandActivity(a, '2026-01-01', '2026-05-01').map((o) => o.date),
    ).toEqual(['2026-01-31', '2026-03-31'])
  })
  it('expands old infinite series directly in current range', () => {
    const a = {
      ...base,
      starts_at: toInstant('2000-01-01', '10:00'),
      ends_at: toInstant('2000-01-01', '11:00'),
      recurrence: { frequency: 'daily' as const, interval: 1, until: null },
    }
    expect(expandActivity(a, '2026-10-01', '2026-10-08')).toHaveLength(7)
  })
  it('handles heldag across 23-hour spring day', () => {
    const a = {
      ...base,
      all_day: true,
      starts_at: toInstant('2026-03-29', '00:00'),
      ends_at: toInstant('2026-03-30', '00:00'),
      recurrence: null,
    }
    const [o] = expandActivity(a, '2026-03-29', '2026-03-31')
    expect(onDay(o!, '2026-03-29')).toBe(true)
    expect(onDay(o!, '2026-03-30')).toBe(false)
    expect(Date.parse(o!.ends_at) - Date.parse(o!.starts_at)).toBe(23 * 3600000)
  })
  it('includes overlapping multi-day events', () =>
    expect(
      expandActivity(
        {
          ...base,
          recurrence: null,
          starts_at: toInstant('2026-03-21', '23:00'),
          ends_at: toInstant('2026-03-23', '01:00'),
        },
        '2026-03-22',
        '2026-03-23',
      ),
    ).toHaveLength(1))
  it('omits deleted events', () =>
    expect(
      expandActivity(
        { ...base, deleted_at: '2026-03-01' },
        '2026-03-22',
        '2026-04-01',
      ),
    ).toEqual([]))
})
describe('participants, validation and school', () => {
  it('filters with any matching participant and category', () => {
    expect(visibleTo(base, ['neo'])).toBe(true)
    expect(visibleTo(base, ['sally'])).toBe(false)
    expect(visibleTo(base, [])).toBe(true)
    expect(visibleTo(base, ['neo'], 'school')).toBe(false)
  })
  it('rejects missing/duplicate/unknown participants and inverted times', () => {
    for (const patch of [
      { participant_ids: [] },
      { participant_ids: ['neo', 'neo'] },
      { participant_ids: ['admin'] },
      { ends_at: base.starts_at },
    ])
      expect(() => validateActivity({ ...base, ...patch })).toThrow()
  })
  it('starts weeks on Monday and uses full month grid', () => {
    expect(weekStart('2026-10-18')).toBe('2026-10-12')
    expect(monthGrid('2026-10-13')).toHaveLength(42)
    expect(monthGrid('2026-10-13')[0]).toBe('2026-09-28')
  })
  it('expands school weekly until manual update and excludes holidays', () => {
    const rows = expandSchool(
      {
        id: 'test',
        student_id: 'neo',
        external_id: 'test',
        weekday: 1,
        starts_at: '10:00:00',
        ends_at: '11:00:00',
        subject: 'Fixture',
        room: null,
        term_start: '2026-10-01',
        term_end: null,
        exception_dates: ['2026-10-19'],
      },
      '2026-10-01',
      '2026-11-01',
    )
    expect(rows.map((o) => o.date)).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-26',
    ])
  })
})
