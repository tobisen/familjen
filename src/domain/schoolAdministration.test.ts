// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import {
  calendarDatabase,
  calendarRpc,
  asCalendarRole,
  testUser,
} from '../../tests/support/database'
import {
  parseDraft,
  prepareSchoolImport,
  lessonIssues,
  exceptionRange,
  type SchoolDraft,
} from './publicSchoolImport'
import { expandSchool, localParts } from './calendar'
import type { PGlite } from '@electric-sql/pglite'
const draft: SchoolDraft = {
  student_id: 'sally',
  source: 'Test only',
  period_key: 'ht2026',
  term_start: '2026-10-19',
  term_end: '2026-11-02',
  exception_dates: ['2026-10-26'],
  lessons: [
    {
      external_id: 'math',
      weekday: 1,
      starts_at: '10:00',
      ends_at: '11:00',
      subject: 'Test mathematics',
      room: 'A1',
      confirmed: true,
    },
    {
      external_id: 'unknown',
      weekday: 2,
      starts_at: '09:00',
      ends_at: null,
      subject: 'Unknown end',
      room: null,
      confirmed: false,
    },
  ],
}
let db: PGlite | undefined
afterEach(async () => {
  await db?.close()
  db = undefined
})
it('partially imports only complete confirmed lessons, preserving uncertainty', () => {
  const parsed = parseDraft(draft)
  const rows = prepareSchoolImport(
    parsed,
    draft.term_start!,
    draft.term_end,
    draft.exception_dates,
    true,
  )
  expect(rows).toHaveLength(1)
  expect(parsed.lessons).toHaveLength(2)
  expect(lessonIssues(parsed.lessons[1]!)).toEqual(
    expect.arrayContaining(['Sluttid saknas']),
  )
  expect(
    prepareSchoolImport(
      {
        ...draft,
        lessons: [
          { ...draft.lessons[0]!, confirmed: false },
          draft.lessons[0]!,
        ],
      },
      draft.term_start!,
      draft.term_end,
      [],
      true,
    ),
  ).toHaveLength(1)
})
it('respects inclusive term limits, holidays, per-lesson exceptions and Stockholm DST', () => {
  const [row] = prepareSchoolImport(
    draft,
    draft.term_start!,
    draft.term_end,
    draft.exception_dates,
    true,
  )
  const result = expandSchool(
    { ...row!, id: 'fixture' },
    '2026-10-12',
    '2026-11-10',
  )
  expect(result.map((x) => x.date)).toEqual(['2026-10-19', '2026-11-02'])
  expect(result.map((x) => x.starts_at)).toEqual([
    '2026-10-19T08:00:00Z',
    '2026-11-02T09:00:00Z',
  ])
  expect(result.map((x) => localParts(x.starts_at).time)).toEqual([
    '10:00',
    '10:00',
  ])
  const special = prepareSchoolImport(
    {
      ...draft,
      lessons: [{ ...draft.lessons[0]!, exception_dates: ['2026-11-02'] }],
    },
    draft.term_start!,
    draft.term_end,
    draft.exception_dates,
    true,
  )
  expect(
    expandSchool({ ...special[0]!, id: 'f' }, '2026-10-12', '2026-11-10'),
  ).toHaveLength(1)
})
describe('private school administration SQL', () => {
  it('saves drafts without activation; idempotent partial activation retains family activities and supports scoped replacement', async () => {
    db = await calendarDatabase()
    const save = async (
      payload: SchoolDraft,
      version: number | null,
      activate = false,
      replace_missing = false,
    ) =>
      calendarRpc(db!, 'school_save', {
        payload,
        expected_version: version,
        activate,
        replace_missing,
      }) as Promise<{ record: { version: number }; count: number }>
    const familyEvent = await calendarRpc(db, 'calendar_save', {
      payload: {
        title: 'Keep private activity',
        description: '',
        location: '',
        starts_at: '2026-10-19T08:00:00Z',
        ends_at: '2026-10-19T09:00:00Z',
        all_day: false,
        participant_ids: ['neo'],
        category: 'family',
        recurrence: null,
        exception_dates: [],
      },
    })
    const first = await save(draft, null)
    expect(first.count).toBe(0)
    expect(
      (await db.query('select * from public.private_school_lessons')).rows,
    ).toHaveLength(0)
    const second = await save(draft, first.record.version, true)
    expect(second.count).toBe(1)
    const original = (
      await db.query<{ id: string }>(
        'select id from public.private_school_lessons',
      )
    ).rows[0]!.id
    const third = await save(draft, second.record.version, true)
    expect(
      (
        await db.query<{ id: string }>(
          'select id from public.private_school_lessons',
        )
      ).rows,
    ).toEqual([{ id: original }])
    await expect(save(draft, second.record.version, true)).rejects.toThrow(
      /annan enhet/,
    )
    const otherTerm = { ...draft, period_key: 'vt2027' }
    await save(otherTerm, null, true)
    const replaced = {
      ...draft,
      lessons: [
        { ...draft.lessons[0]!, external_id: 'new', subject: 'New test' },
      ],
    }
    await save(replaced, third.record.version, true, true)
    const rows = await db.query<{ external_id: string }>(
      'select external_id from public.private_school_lessons order by external_id',
    )
    expect(rows.rows.map((r) => r.external_id)).toEqual([
      'period:ht2026:new',
      'period:vt2027:math',
    ])
    expect(
      (
        await db.query<{ id: string }>(
          'select id from public.private_calendar_events',
        )
      ).rows,
    ).toEqual([{ id: familyEvent }])
  })
  it('blocks anonymous and unaffiliated access and direct table writes', async () => {
    db = await calendarDatabase()
    await expect(
      asCalendarRole(db, 'anon', () =>
        db!.query('select public.school_snapshot()'),
      ),
    ).rejects.toThrow()
    await expect(
      asCalendarRole(db, 'anon', () =>
        db!.query('select * from public.private_school_imports'),
      ),
    ).rejects.toThrow()
    await expect(calendarRpc(db, 'school_snapshot', {}, '')).rejects.toThrow()
    await expect(
      asCalendarRole(
        db,
        'authenticated',
        () => db!.query('delete from public.private_school_imports'),
        testUser,
      ),
    ).rejects.toThrow()
    await calendarRpc(db, 'school_save', { payload: draft })
    await db.exec(
      "insert into auth.users values ('00000000-0000-0000-0000-000000000099')",
    )
    await expect(
      calendarRpc(
        db,
        'school_snapshot',
        {},
        '00000000-0000-0000-0000-000000000099',
      ),
    ).rejects.toThrow()
    expect(
      await asCalendarRole(
        db,
        'authenticated',
        async () =>
          (await db!.query('select * from public.private_school_imports')).rows,
        '00000000-0000-0000-0000-000000000099',
      ),
    ).toHaveLength(0)
  })
  it('requires real dates and verified complete times on server and rejects duplicate IDs', async () => {
    db = await calendarDatabase()
    for (const payload of [
      { ...draft, term_end: null },
      { ...draft, lessons: [draft.lessons[1]] },
      { ...draft, lessons: [draft.lessons[0], draft.lessons[0]] },
      { ...draft, term_start: '2026-02-30' },
    ])
      await expect(
        calendarRpc(db, 'school_save', { payload, activate: true }),
      ).rejects.toThrow()
    await expect(
      calendarRpc(db, 'calendar_import', {
        lessons: [
          {
            ...draft.lessons[0],
            student_id: 'sally',
            term_start: '2026-10-19',
            term_end: '2026-11-02',
            starts_at: null,
            exception_dates: [],
          },
        ],
      }),
    ).rejects.toThrow()
  })
})

it('expands verified holiday ranges inclusively without guessing dates', () => {
  expect(exceptionRange('2026-10-26', '2026-10-30')).toHaveLength(5)
  expect(exceptionRange('2026-10-26', '2026-10-26')).toEqual(['2026-10-26'])
  expect(() => exceptionRange('2026-02-30', '2026-03-02')).toThrow()
  expect(() => exceptionRange('2026-11-01', '2026-10-26')).toThrow()
})

it('isolates imported drafts between two authenticated families even with forged family metadata', async () => {
  db = await calendarDatabase()
  const other = '00000000-0000-0000-0000-000000000088'
  const family = '00000000-0000-0000-0000-000000000089'
  await db.exec(
    `insert into auth.users values ('${other}'); insert into public.families(id,name) values ('${family}','Other test family'); insert into public.profiles(family_id,auth_user_id,display_name,profile_key) values ('${family}','${other}','Other','neo')`,
  )
  await calendarRpc(db, 'school_save', { payload: draft })
  expect(await calendarRpc(db, 'school_snapshot', {}, other)).toEqual([])
  const original = (
    await db.query<{ family_id: string }>(
      'select family_id from public.private_school_imports',
    )
  ).rows[0]!.family_id
  await calendarRpc(
    db,
    'school_save',
    {
      payload: {
        ...draft,
        family_id: original,
        source: 'Other family own draft',
      },
    },
    other,
  )
  const snapshot = (await calendarRpc(db, 'school_snapshot', {})) as {
    draft: { source: string }
  }[]
  expect(snapshot).toHaveLength(1)
  expect(snapshot[0]!.draft.source).toBe(draft.source)
  expect(
    (
      await asCalendarRole(
        db,
        'authenticated',
        () => db!.query('select family_id from public.private_school_imports'),
        other,
      )
    ).rows,
  ).toEqual([{ family_id: family }])
})
