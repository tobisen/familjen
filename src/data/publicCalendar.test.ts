// @vitest-environment node
import { beforeAll, afterAll, it, expect } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  calendarDatabase,
  calendarRpc,
  asCalendarRole,
  testUser,
} from '../../tests/support/database'
let db: PGlite
const stranger = '00000000-0000-0000-0000-000000000099'
const otherUser = '00000000-0000-0000-0000-000000000012'
const otherFamily = '00000000-0000-0000-0000-000000000002'
const input = {
  title: 'Fixture',
  description: '',
  location: '',
  starts_at: '2026-10-13T08:00:00Z',
  ends_at: '2026-10-13T09:00:00Z',
  all_day: false,
  participant_ids: ['tobias', 'neo'],
  category: 'family',
  recurrence: null,
  exception_dates: [],
}
beforeAll(async () => {
  db = await calendarDatabase()
  await db.exec(`insert into auth.users values ('${stranger}'),('${otherUser}'); insert into public.families(id,name) values ('${otherFamily}','Other');
 insert into public.profiles(family_id,display_name,profile_key,auth_user_id) values ('${otherFamily}','Neo','neo','${otherUser}');
 insert into public.private_calendar_people values('neo','Neo','green','${otherFamily}');
 insert into public.private_calendar_settings(family_id) values('${otherFamily}');`)
}, 30000)
afterAll(async () => db?.close())
it('denies anonymous reads/writes on ALL 14 family tables', async () => {
  for (const t of [
    'families',
    'profiles',
    'calendar_events',
    'event_participants',
    'school_lessons',
    'tasks',
    'shopping_items',
    'chat_messages',
    'push_subscriptions',
    'positions',
    'private_calendar_people',
    'private_calendar_events',
    'private_school_lessons',
    'private_calendar_settings',
  ]) {
    await expect(
      asCalendarRole(db, 'anon', () => db.query(`select * from public.${t}`)),
    ).rejects.toThrow(/permission denied/)
    await expect(
      asCalendarRole(db, 'anon', () => db.query(`delete from public.${t}`)),
    ).rejects.toThrow(/permission denied/)
  }
})
it('removes all old public RPCs and denies anonymous execution of every new RPC', async () => {
  for (const name of [
    'public_calendar_snapshot',
    'public_calendar_save',
    'public_calendar_delete',
    'public_calendar_import',
    'open_calendar_enabled',
  ])
    expect(
      (await db.query('select proname from pg_proc where proname=$1', [name]))
        .rows,
    ).toHaveLength(0)
  for (const call of [
    'calendar_snapshot()',
    'calendar_identity()',
    'calendar_family_id()',
    'require_calendar_family()',
    `calendar_save('{}'::jsonb,null,null)`,
    `calendar_delete(null,null)`,
    `calendar_import('[]'::jsonb)`,
  ])
    await expect(
      asCalendarRole(db, 'anon', () => db.query(`select public.${call}`)),
    ).rejects.toThrow(/permission denied/)
})
it('refuses authenticated nonmembers and derives profile identity from auth.uid', async () => {
  expect(await calendarRpc(db, 'calendar_identity', {}, stranger)).toBeNull()
  for (const [name, args] of [
    ['calendar_snapshot', {}],
    ['calendar_save', { payload: input }],
    ['calendar_delete', { event_id: null, expected_version: 1 }],
    ['calendar_import', { lessons: [] }],
  ] as const)
    await expect(calendarRpc(db, name, args, stranger)).rejects.toThrow(
      /familjeidentitet/,
    )
  expect(await calendarRpc(db, 'calendar_identity', {})).toMatchObject({
    profile_key: 'neo',
  })
})
it('enforces family isolation, server author attribution and optimistic versions', async () => {
  const id = await calendarRpc(db, 'calendar_save', {
    payload: { ...input, family_id: otherFamily, created_by: stranger },
  })
  expect(
    (
      (await calendarRpc(db, 'calendar_snapshot', {}, otherUser)) as {
        activities: unknown[]
      }
    ).activities,
  ).toHaveLength(0)
  const snap = (await calendarRpc(db, 'calendar_snapshot', {})) as {
    activities: {
      id: string
      version: number
      family_id: string
      created_by: string
    }[]
  }
  expect(snap.activities).toHaveLength(1)
  expect(snap.activities[0]!.family_id).not.toBe(otherFamily)
  const author = await db.query<{ id: string }>(
    'select id from public.profiles where auth_user_id=$1',
    [testUser],
  )
  expect(snap.activities[0]!.created_by).toBe(author.rows[0]!.id)
  await expect(
    calendarRpc(
      db,
      'calendar_save',
      { payload: input, event_id: id, expected_version: 1 },
      otherUser,
    ),
  ).rejects.toThrow(/finns inte/)
  await expect(
    calendarRpc(
      db,
      'calendar_delete',
      { event_id: id, expected_version: 1 },
      otherUser,
    ),
  ).rejects.toThrow(/ändrats/)
  await calendarRpc(db, 'calendar_save', {
    payload: { ...input, title: 'Updated' },
    event_id: id,
    expected_version: 1,
  })
  await expect(
    calendarRpc(db, 'calendar_save', {
      payload: input,
      event_id: id,
      expected_version: 1,
    }),
  ).rejects.toThrow(/annan enhet/)
  await calendarRpc(db, 'calendar_delete', {
    event_id: id,
    expected_version: 2,
  })
  expect(
    (
      (await calendarRpc(db, 'calendar_snapshot', {})) as {
        activities: unknown[]
      }
    ).activities,
  ).toHaveLength(0)
})
it('keeps direct writes and membership changes admin-only for authenticated members', async () => {
  for (const sql of [
    'delete from public.private_calendar_events',
    'update public.private_calendar_settings set revision=99',
    "update public.profiles set profile_key='sally'",
    'delete from public.families',
  ])
    await expect(
      asCalendarRole(db, 'authenticated', () => db.query(sql), testUser),
    ).rejects.toThrow(/permission denied/)
})
it('validates participants, recurrence, dates and heldag on the server', async () => {
  for (const patch of [
    { participant_ids: ['admin'] },
    { participant_ids: ['neo', 'neo'] },
    { recurrence: { frequency: 'invalid', interval: 1 } },
    { recurrence: { interval: 1 } },
    { ends_at: input.starts_at },
    { exception_dates: ['2026-02-30'] },
    { all_day: true },
  ])
    await expect(
      calendarRpc(db, 'calendar_save', { payload: { ...input, ...patch } }),
    ).rejects.toThrow()
})
it('requires term bounds, upserts per family and rolls back invalid batches', async () => {
  const l = {
    student_id: 'neo',
    external_id: 'fixture',
    weekday: 1,
    starts_at: '10:00',
    ends_at: '11:00',
    subject: 'Fixture',
    room: null,
    term_start: '2026-10-01',
    term_end: '2026-12-20',
    exception_dates: [],
  }
  await expect(
    calendarRpc(db, 'calendar_import', { lessons: [{ ...l, term_end: null }] }),
  ).rejects.toThrow(/terminsperiod/)
  await calendarRpc(db, 'calendar_import', { lessons: [l] })
  await calendarRpc(db, 'calendar_import', {
    lessons: [{ ...l, subject: 'Updated' }],
  })
  const snap = (await calendarRpc(db, 'calendar_snapshot', {})) as {
    lessons: { subject: string }[]
  }
  expect(snap.lessons).toHaveLength(1)
  expect(snap.lessons[0]!.subject).toBe('Updated')
  expect(
    (
      (await calendarRpc(db, 'calendar_snapshot', {}, otherUser)) as {
        lessons: unknown[]
      }
    ).lessons,
  ).toHaveLength(0)
  await expect(
    calendarRpc(db, 'calendar_import', {
      lessons: [
        { ...l, external_id: 'new' },
        { ...l, external_id: 'invalid', ends_at: null },
      ],
    }),
  ).rejects.toThrow()
  expect(
    ((await calendarRpc(db, 'calendar_snapshot', {})) as { lessons: unknown[] })
      .lessons,
  ).toHaveLength(1)
  await expect(
    calendarRpc(db, 'calendar_import', { lessons: [l, l] }),
  ).rejects.toThrow(/Dubblerade/)
})
it('membership removal immediately revokes all calendar RPCs and RLS reads', async () => {
  await db.exec(
    `update public.profiles set auth_user_id=null where auth_user_id='${testUser}'`,
  )
  await expect(calendarRpc(db, 'calendar_snapshot', {})).rejects.toThrow(
    /familjeidentitet/,
  )
  expect(
    (
      await asCalendarRole(
        db,
        'authenticated',
        () => db.query('select * from public.private_calendar_events'),
        testUser,
      )
    ).rows,
  ).toHaveLength(0)
})
