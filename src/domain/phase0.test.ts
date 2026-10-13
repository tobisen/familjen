import { describe, it, expect, beforeEach } from 'vitest'
import { readProfile, selectProfile, selectedProfile } from './profiles'
import { parseSchoolImport } from './schoolImport'
describe('local profile preference', () => {
  beforeEach(() => localStorage.clear())
  it('restores only known profiles', () => {
    expect(readProfile()).toBeNull()
    selectProfile('neo')
    expect(readProfile()).toBe('neo')
    expect(selectedProfile.value).toBe('neo')
    localStorage.setItem('familjen.profile', 'admin')
    expect(readProfile()).toBeNull()
  })
})
describe('school import validation', () => {
  const lesson = {
    external_id: 'fixture-only',
    student_id: '00000000-0000-0000-0000-000000000001',
    weekday: 1,
    starts_at: '10:00',
    ends_at: '11:00',
    subject: 'Test fixture',
    room: null,
    term_start: '2026-01-01',
    term_end: '2026-06-01',
    exception_dates: [],
  }
  it('accepts empty data without inventing lessons', () =>
    expect(parseSchoolImport([])).toEqual([]))
  it('retains stable IDs for upsert', () =>
    expect(parseSchoolImport([lesson])[0]?.external_id).toBe(
      lesson.external_id,
    ))
  it('rejects duplicates', () =>
    expect(() => parseSchoolImport([lesson, lesson])).toThrow())
  it.each([
    { weekday: 0 },
    { ends_at: '09:00' },
    { starts_at: '25:00' },
    { term_start: '2026-02-30' },
    { exception_dates: ['invalid'] },
    { student_id: 'neo' },
  ])('rejects invalid fields %j', (patch) =>
    expect(() => parseSchoolImport([{ ...lesson, ...patch }])).toThrow(),
  )
})
