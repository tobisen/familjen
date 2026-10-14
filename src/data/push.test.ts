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
const sally = '00000000-0000-0000-0000-000000000012'
const endpoint = 'https://fcm.googleapis.com/fcm/send/fixture'
const subscription = {
  endpoint,
  keys: { p256dh: 'A'.repeat(87), auth: 'A'.repeat(22) },
}
async function rpc(fn: string, args: unknown, user = testUser) {
  return asCalendarRole(
    db,
    'authenticated',
    async () =>
      (
        await db.query<{ result: unknown }>(
          `select public.${fn}($1::jsonb) as result`,
          [JSON.stringify(args)],
        )
      ).rows[0]!.result,
    user,
  )
}
beforeAll(async () => {
  db = await calendarDatabase()
  await db.exec(
    `insert into auth.users values('${sally}'); insert into auth.sessions values('${sally}','${sally}'); update public.profiles set auth_user_id='${sally}' where profile_key='sally'`,
  )
})
afterAll(() => db.close())
it('binds subscriptions to server identity and prevents endpoint takeover', async () => {
  const id = await rpc('push_register', {
    ...subscription,
    profile_id: 'forged',
    family_id: 'forged',
  })
  expect(await rpc('push_register', subscription)).toBe(id)
  await expect(rpc('push_register', subscription, sally)).rejects.toThrow(
    /annan registrering/,
  )
  await expect(
    rpc('push_register', {
      ...subscription,
      endpoint: 'https://127.0.0.1/internal',
    }),
  ).rejects.toThrow()
  const rows = await db.query<{ profile_id: string }>(
    'select profile_id from public.push_subscriptions',
  )
  expect(rows.rows).toHaveLength(1)
  expect(rows.rows[0]!.profile_id).toBe(
    (
      await db.query<{ id: string }>(
        "select id from public.profiles where profile_key='neo'",
      )
    ).rows[0]!.id,
  )
})
it('queues new chat once for others and never queues edit/delete notifications', async () => {
  const request_id = crypto.randomUUID()
  const message = (await calendarRpc(db, 'chat_send', {
    message_body: 'Push fixture',
    request_id,
  })) as { id: string }
  await calendarRpc(db, 'chat_send', {
    message_body: 'Push fixture',
    request_id,
  })
  const jobs = await db.query<{ recipient_id: string }>(
    'select recipient_id from private.push_jobs where object_id=$1',
    [message.id],
  )
  expect(jobs.rows).toHaveLength(1)
  expect(jobs.rows[0]!.recipient_id).toBe(
    (
      await db.query<{ id: string }>(
        "select id from public.profiles where profile_key='sally'",
      )
    ).rows[0]!.id,
  )
  await calendarRpc(db, 'chat_change', {
    message_id: message.id,
    message_body: 'Edited',
    expected_version: 1,
  })
  expect(
    (
      await db.query('select * from private.push_jobs where object_id=$1', [
        message.id,
      ])
    ).rows,
  ).toHaveLength(1)
  await calendarRpc(db, 'chat_change', {
    message_id: message.id,
    expected_version: 2,
    remove_message: true,
  })
  expect(
    (
      await db.query<{ canceled: boolean }>(
        'select canceled from private.push_jobs where object_id=$1',
        [message.id],
      )
    ).rows[0]!.canceled,
  ).toBe(true)
})
it('activity participants receive create/change/cancel and actor gets no own action', async () => {
  const id = await calendarRpc(db, 'calendar_save', {
    payload: {
      title: 'Fixture event',
      description: '',
      location: '',
      starts_at: '2026-10-15T08:00:00Z',
      ends_at: '2026-10-15T09:00:00Z',
      all_day: false,
      participant_ids: ['neo', 'sally'],
      category: 'family',
      recurrence: null,
      exception_dates: [],
    },
  })
  expect(
    (await db.query('select * from private.push_jobs where object_id=$1', [id]))
      .rows,
  ).toHaveLength(1)
  await calendarRpc(
    db,
    'calendar_delete',
    { event_id: id, expected_version: 1 },
    sally,
  )
  const jobs = await db.query<{
    payload: { title: string }
    canceled: boolean
  }>(
    'select payload,canceled from private.push_jobs where object_id=$1 order by created_at',
    [id],
  )
  expect(jobs.rows).toHaveLength(2)
  expect(jobs.rows[0]!.canceled).toBe(true)
  expect(jobs.rows[1]!.payload.title).toBe('Inställd aktivitet')
})
it('task notification recipient selection runs after assignments and handles completion', async () => {
  const id = await calendarRpc(db, 'lists_save', {
    kind: 'task',
    payload: {
      title: 'Fixture assigned task',
      description: '',
      deadline: '2026-10-20',
      priority: 'normal',
      recurrence: null,
      assigned_ids: ['neo', 'sally'],
      reminder_days: null,
    },
    request_id: crypto.randomUUID(),
  })
  expect(
    (
      await db.query(
        'select * from private.push_jobs where object_id=$1 and not canceled',
        [id],
      )
    ).rows,
  ).toHaveLength(1)
  await calendarRpc(
    db,
    'lists_set_done',
    { kind: 'task', item_id: id, done: true, expected_version: 1 },
    sally,
  )
  const jobs = await db.query<{ payload: { title: string } }>(
    'select payload from private.push_jobs where object_id=$1 and not canceled',
    [id],
  )
  expect(jobs.rows).toHaveLength(1)
  expect(jobs.rows[0]!.payload.title).toBe('Uppgift klar')
})
it('groups rapid shopping additions but never sends purchase notifications', async () => {
  const ids = []
  for (const title of ['Fixture apples', 'Fixture bread'])
    ids.push(
      await calendarRpc(db, 'lists_save', {
        kind: 'shopping',
        payload: { title, amount: 1, unit: '' },
        request_id: crypto.randomUUID(),
      }),
    )
  const jobs = await db.query<{ payload: { count: number } }>(
    "select payload from private.push_jobs where kind='shopping'",
  )
  expect(jobs.rows).toHaveLength(1)
  expect(jobs.rows[0]!.payload.count).toBe(2)
  await calendarRpc(db, 'lists_set_done', {
    kind: 'shopping',
    item_id: ids[0],
    done: true,
    expected_version: 1,
  })
  expect(
    (await db.query("select * from private.push_jobs where kind='shopping'"))
      .rows,
  ).toHaveLength(1)
})
it('claims per device once, leases retries, rejects stale acknowledgements and disables expired subscriptions', async () => {
  await db.exec('delete from private.push_jobs')
  await db.query(
    "select private.push_add((select family_id from public.profiles where profile_key='neo'),(select id from public.profiles where profile_key='neo'),'delivery-fixture','test',null,'Fixture','Body','/chatt')",
  )
  const claim = async () =>
    (
      await db.query<{ result: { id: string; lease: string }[] }>(
        'select public.push_claim(30) as result',
      )
    ).rows[0]!.result
  const first = await claim()
  expect(first).toHaveLength(1)
  expect(await claim()).toHaveLength(0)
  await db.query('select public.push_finish($1,$2,503)', [
    first[0]!.id,
    first[0]!.lease,
  ])
  expect(await claim()).toHaveLength(0)
  await db.exec(
    "update private.push_deliveries set next_at=now()-interval '1 minute'",
  )
  const retry = await claim()
  expect(retry).toHaveLength(1)
  await db.query('select public.push_finish($1,$2,201)', [
    first[0]!.id,
    first[0]!.lease,
  ])
  expect(
    (
      await db.query<{ status: string }>(
        'select status from private.push_deliveries',
      )
    ).rows[0]!.status,
  ).toBe('sending')
  await db.query('select public.push_finish($1,$2,410)', [
    retry[0]!.id,
    retry[0]!.lease,
  ])
  expect(
    (
      await db.query<{ active: boolean }>(
        'select active from public.push_subscriptions',
      )
    ).rows[0]!.active,
  ).toBe(false)
})
it('denies anonymous and authenticated direct access to subscriptions, queue and server functions', async () => {
  for (const role of ['anon', 'authenticated'] as const) {
    for (const table of [
      'public.push_subscriptions',
      'private.push_jobs',
      'private.push_deliveries',
    ])
      await expect(
        asCalendarRole(
          db,
          role,
          () => db.query(`select * from ${table}`),
          testUser,
        ),
      ).rejects.toThrow()
    for (const fn of [
      'push_schedule_snapshot()',
      'push_claim(30)',
      'push_cleanup()',
    ])
      await expect(
        asCalendarRole(
          db,
          role,
          () => db.query(`select public.${fn}`),
          testUser,
        ),
      ).rejects.toThrow()
  }
})

it('refreshes a canceled unsent reminder using the same job ID, while already delivered jobs stay suppressed', async () => {
  const add = async (body: string) =>
    db.query(
      "select private.push_add((select family_id from public.profiles where profile_key='neo'),(select id from public.profiles where profile_key='neo'),'refresh-fixture','activity-reminder',null,'Reminder',$1,'/kalender')",
      [body],
    )
  await add('Original')
  const row = (
    await db.query<{ id: string }>(
      "select id from private.push_jobs where dedupe_key='refresh-fixture'",
    )
  ).rows[0]!
  await db.query('update private.push_jobs set canceled=true where id=$1', [
    row.id,
  ])
  await add('Updated')
  const current = (
    await db.query<{
      id: string
      canceled: boolean
      payload: { body: string }
    }>('select id,canceled,payload from private.push_jobs where id=$1', [
      row.id,
    ])
  ).rows[0]!
  expect(current.id).toBe(row.id)
  expect(current.canceled).toBe(false)
  expect(current.payload.body).toBe('Updated')
  await db.query(
    "insert into private.push_deliveries(job_id,subscription_id,status) select $1,id,'sent' from public.push_subscriptions limit 1",
    [row.id],
  )
  await db.query('update private.push_jobs set canceled=true where id=$1', [
    row.id,
  ])
  await add('Do not resend')
  expect(
    (
      await db.query<{ canceled: boolean }>(
        'select canceled from private.push_jobs where id=$1',
        [row.id],
      )
    ).rows[0]!.canceled,
  ).toBe(true)
})
it('expires a crashed final retry instead of leaving a permanent sending lease', async () => {
  await db.exec(
    "update private.push_deliveries set status='sending',attempts=6,lease_until=now()-interval '1 minute';select public.push_expire_leases();",
  )
  expect(
    (
      await db.query(
        "select * from private.push_deliveries where status='sending'",
      )
    ).rows,
  ).toHaveLength(0)
})
it('revoking an auth session also removes that device subscription', async () => {
  await db.query('delete from auth.sessions where id=$1', [testUser])
  expect(
    (await db.query('select * from public.push_subscriptions')).rows,
  ).toHaveLength(0)
})
