// @vitest-environment node
import { beforeAll, afterAll, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { PGlite } from '@electric-sql/pglite'
import {
  calendarDatabase,
  calendarRpc,
  asCalendarRole,
  testUser,
} from '../../tests/support/database'
import {
  occurrences,
  toInstant,
  type CalendarActivity,
} from '../domain/calendar'
import type { ChatMessage, ChatSummary } from '../domain/chat'
let db: PGlite
const sally = '00000000-0000-0000-0000-000000000012'
const rpc = (
  name: string,
  args: Record<string, unknown> = {},
  user = testUser,
) => calendarRpc(db, name, args, user)
const payload = {
  title: 'Serie',
  description: '',
  location: '',
  all_day: false,
  starts_at: toInstant('2026-10-18', '10:00'),
  ends_at: toInstant('2026-10-18', '11:00'),
  category: 'family',
  participant_ids: ['sally'],
  recurrence: { frequency: 'weekly', interval: 1, until: '2026-11-01' },
  exception_dates: [],
}
beforeAll(async () => {
  db = await calendarDatabase()
  await db.exec(
    `insert into auth.users values('${sally}'); update public.profiles set auth_user_id='${sally}' where profile_key='sally'`,
  )
}, 30000)
afterAll(async () => db.close())
it('joins and leaves only the authenticated profile, with version conflicts and a last-participant guard', async () => {
  const id = await rpc('calendar_save', { payload })
  await rpc('calendar_participate', {
    event_id: id,
    expected_version: 1,
    joining: true,
  })
  let row = (
    (await rpc('calendar_snapshot')) as { activities: CalendarActivity[] }
  ).activities.find((a) => a.id === id)!
  expect(row.participant_ids.sort()).toEqual(['neo', 'sally'])
  await expect(
    rpc('calendar_participate', {
      event_id: id,
      expected_version: 1,
      joining: false,
    }),
  ).rejects.toThrow(/ändrats/)
  await rpc('calendar_participate', {
    event_id: id,
    expected_version: 2,
    joining: false,
  })
  row = (
    (await rpc('calendar_snapshot')) as { activities: CalendarActivity[] }
  ).activities.find((a) => a.id === id)!
  expect(row.participant_ids).toEqual(['sally'])
  await expect(
    rpc(
      'calendar_participate',
      { event_id: id, expected_version: 3, joining: false },
      sally,
    ),
  ).rejects.toThrow(/Minst/)
})
it('atomically replaces one occurrence across DST, respects until, and prevents duplicate retries', async () => {
  const id = await rpc('calendar_save', { payload })
  const replacement = {
    ...payload,
    title: 'Ändrat tillfälle',
    starts_at: toInstant('2026-10-25', '12:00'),
    ends_at: toInstant('2026-10-25', '13:00'),
  }
  const args = {
    event_id: id,
    expected_version: 1,
    occurrence_date: '2026-10-25',
    payload: replacement,
  }
  await rpc('calendar_save_occurrence', args)
  await expect(rpc('calendar_save_occurrence', args)).rejects.toThrow(/ändrats/)
  const rows = (
    (await rpc('calendar_snapshot')) as { activities: CalendarActivity[] }
  ).activities.filter((a) => a.id === id || a.title === 'Ändrat tillfälle')
  const expanded = occurrences(rows, [], '2026-10-18', '2026-11-10')
  expect(expanded.map((o) => o.date)).toEqual([
    '2026-10-18',
    '2026-10-25',
    '2026-11-01',
  ])
  expect(expanded.find((o) => o.date === '2026-10-25')?.activity.title).toBe(
    'Ändrat tillfälle',
  )
  expect(expanded.find((o) => o.date === '2026-11-01')?.starts_at).toBe(
    '2026-11-01T09:00:00Z',
  )
  await expect(
    rpc('calendar_save_occurrence', {
      ...args,
      expected_version: 2,
      occurrence_date: '2026-11-08',
    }),
  ).rejects.toThrow(/finns/)
})
it('rolls back an exception when the replacement fails validation', async () => {
  const id = await rpc('calendar_save', { payload })
  await expect(
    rpc('calendar_save_occurrence', {
      event_id: id,
      expected_version: 1,
      occurrence_date: '2026-10-25',
      payload: { ...payload, title: '' },
    }),
  ).rejects.toThrow()
  const row = (
    (await rpc('calendar_snapshot')) as { activities: CalendarActivity[] }
  ).activities.find((a) => a.id === id)!
  expect(row.version).toBe(1)
  expect(row.exception_dates).toEqual([])
})
it('assigns only the session owner without replacing existing assignees', async () => {
  const id = await rpc('lists_save', {
    kind: 'task',
    request_id: randomUUID(),
    payload: {
      title: 'Gemensam',
      description: '',
      priority: 'normal',
      deadline: null,
      assigned_ids: ['sally'],
      recurrence: null,
      reminder_days: null,
    },
  })
  await rpc('task_assign_self', { item_id: id, expected_version: 1 })
  const row = (
    (await rpc('lists_snapshot')) as {
      tasks: { id: string; assigned_ids: string[] }[]
    }
  ).tasks.find((t) => t.id === id)!
  expect(row.assigned_ids.sort()).toEqual(['neo', 'sally'])
  await expect(
    rpc('task_assign_self', { item_id: id, expected_version: 1 }),
  ).rejects.toThrow(/ändrats/)
})
it('hides deletions in direct reads, both pagination directions, summaries, and unread counts while signalling revisions', async () => {
  const m = (await rpc(
    'chat_send',
    { message_body: 'Försvinner', request_id: randomUUID() },
    sally,
  )) as ChatMessage
  expect(((await rpc('chat_summary')) as ChatSummary).unread).toBe(1)
  const before = await asCalendarRole(
    db,
    'authenticated',
    () =>
      db.query<{ revision: number }>(
        'select revision from public.chat_revisions',
      ),
    testUser,
  )
  await rpc(
    'chat_change',
    {
      message_id: m.id,
      message_body: '',
      expected_version: 1,
      remove_message: true,
    },
    sally,
  )
  expect(await rpc('chat_page')).toEqual([])
  expect(await rpc('chat_page', { after_seq: 0 })).toEqual([])
  const direct = await asCalendarRole(
    db,
    'authenticated',
    () => db.query('select * from public.chat_messages'),
    testUser,
  )
  expect(direct.rows).toEqual([])
  const summary = (await rpc('chat_summary')) as ChatSummary
  expect(summary.unread).toBe(0)
  expect(summary.last_message).toBeNull()
  const after = await asCalendarRole(
    db,
    'authenticated',
    () =>
      db.query<{ revision: number }>(
        'select revision from public.chat_revisions',
      ),
    testUser,
  )
  expect(Number(after.rows[0]!.revision)).toBeGreaterThan(
    Number(before.rows[0]!.revision),
  )
})
it('denies anonymous self-assignment, participation, occurrence edits and revision reads', async () => {
  for (const query of [
    'select public.task_assign_self(null,1)',
    'select public.calendar_participate(null,1,true)',
    "select public.calendar_save_occurrence('{}',null,null,1)",
    'select * from public.chat_revisions',
  ])
    await expect(
      asCalendarRole(db, 'anon', () => db.query(query)),
    ).rejects.toThrow(/permission denied/)
})
it('cleans historical tombstones during migration without altering active text', async () => {
  const old = await calendarDatabase(true, false)
  try {
    const gone = (await calendarRpc(old, 'chat_send', {
      message_body: 'Old deleted text',
      request_id: randomUUID(),
    })) as ChatMessage
    const live = (await calendarRpc(old, 'chat_send', {
      message_body: 'Keep active',
      request_id: randomUUID(),
    })) as ChatMessage
    await old.query(
      'update public.chat_messages set deleted_at=now() where id=$1',
      [gone.id],
    )
    await old.exec(
      readFileSync('supabase/migrations/202610140012_design_ux.sql', 'utf8'),
    )
    expect(await calendarRpc(old, 'chat_page', {})).toMatchObject([
      { id: live.id, body: 'Keep active' },
    ])
    expect(
      (
        await old.query<{ body: string }>(
          'select body from public.chat_messages where id=$1',
          [gone.id],
        )
      ).rows[0]?.body,
    ).toBe('')
  } finally {
    await old.close()
  }
})

it('isolates participation, task assignment, occurrence edits and revision signals between families', async () => {
  const other = randomUUID(),
    family = randomUUID()
  await db.query('insert into auth.users values($1)', [other])
  await db.query(
    "insert into public.families(id,name) values($1,'Other UX family')",
    [family],
  )
  await db.query(
    "insert into public.profiles(family_id,auth_user_id,display_name,profile_key) values($1,$2,'Neo','neo')",
    [family, other],
  )
  const event = await rpc('calendar_save', { payload })
  const task = await rpc('lists_save', {
    kind: 'task',
    request_id: randomUUID(),
    payload: {
      title: 'Other cannot claim',
      description: '',
      priority: 'normal',
      deadline: null,
      assigned_ids: [],
      recurrence: null,
      reminder_days: null,
    },
  })
  await expect(
    rpc(
      'calendar_participate',
      { event_id: event, expected_version: 1, joining: true },
      other,
    ),
  ).rejects.toThrow(/ändrats/)
  await expect(
    rpc('task_assign_self', { item_id: task, expected_version: 1 }, other),
  ).rejects.toThrow(/ändrats/)
  await expect(
    rpc(
      'calendar_save_occurrence',
      {
        event_id: event,
        expected_version: 1,
        occurrence_date: '2026-10-25',
        payload,
      },
      other,
    ),
  ).rejects.toThrow(/ändrats/)
  const revisions = await asCalendarRole(
    db,
    'authenticated',
    () => db.query('select * from public.chat_revisions'),
    other,
  )
  expect(revisions.rows).toEqual([])
})
