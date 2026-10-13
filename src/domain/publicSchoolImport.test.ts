import { it, expect } from 'vitest'
import {
  parseDraft,
  prepareSchoolImport,
  type SchoolDraft,
} from './publicSchoolImport'
const draft: SchoolDraft = {
  student_id: 'neo',
  source: 'Fixture',
  term_start: null,
  term_end: null,
  exception_dates: [],
  lessons: [
    {
      external_id: 'fixture-d1-slot1',
      weekday: 1,
      starts_at: '10:00',
      ends_at: '11:00',
      subject: 'Fixture',
      room: null,
    },
  ],
}
it('requires explicit confirmation before publication', () =>
  expect(() =>
    prepareSchoolImport(draft, '2026-10-13', null, [], false),
  ).toThrow(/Bekräfta/))
it('allows indefinite weekly validity only with explicit start and confirmation', () =>
  expect(
    prepareSchoolImport(parseDraft(draft), '2026-10-13', null, [], true)[0],
  ).toMatchObject({
    term_start: '2026-10-13',
    term_end: null,
    external_id: 'fixture-d1-slot1',
  }))
it('rejects incomplete known or unknown times rather than guessing', () => {
  expect(() =>
    prepareSchoolImport(
      { ...draft, lessons: [{ ...draft.lessons[0]!, ends_at: null }] },
      '2026-10-13',
      null,
      [],
      true,
    ),
  ).toThrow(/verifierad/)
  expect(() =>
    prepareSchoolImport(
      { ...draft, lessons: [] },
      '2026-10-13',
      null,
      [],
      true,
    ),
  ).toThrow()
})
it('rejects duplicates', () =>
  expect(() =>
    parseDraft({ ...draft, lessons: [...draft.lessons, ...draft.lessons] }),
  ).toThrow(/dubblerat/))
it('rejects malformed, invalid dates and times', () => {
  for (const input of [
    null,
    {},
    { ...draft, exception_dates: ['2026-02-30'] },
    { ...draft, lessons: [{ ...draft.lessons[0], starts_at: '25:00' }] },
  ])
    expect(() => parseDraft(input)).toThrow()
})
it('does not mutate source on preparation', () => {
  const rows = prepareSchoolImport(
    draft,
    '2026-10-13',
    null,
    ['2026-10-19', '2026-10-19'],
    true,
  )
  expect(rows[0]!.exception_dates).toHaveLength(1)
  expect(draft.term_start).toBeNull()
})
