// @vitest-environment node
import { beforeAll, afterAll, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import {
  calendarDatabase,
  calendarRpc,
  asCalendarRole,
  testUser,
} from '../../tests/support/database'
import type { ChatMessage, ChatSummary } from '../domain/chat'
let db: PGlite
const sally = '00000000-0000-0000-0000-000000000012',
  other = '00000000-0000-0000-0000-000000000013'
const rpc = (fn: string, args: Record<string, unknown> = {}, user = testUser) =>
  calendarRpc(db, fn, args, user)
const send = (body: string, request = randomUUID(), user = testUser) =>
  rpc(
    'chat_send',
    { message_body: body, request_id: request },
    user,
  ) as Promise<ChatMessage>
const summary = (user = testUser) =>
  rpc('chat_summary', {}, user) as Promise<ChatSummary>
beforeAll(async () => {
  db = await calendarDatabase()
  await db.exec(
    `insert into auth.users values('${sally}'),('${other}');update public.profiles set auth_user_id='${sally}' where profile_key='sally'`,
  )
}, 30000)
afterAll(async () => db.close())
it('sends once with server sender, ordered sequence, and one private notification event', async () => {
  const request = randomUUID(),
    message = await send('Hej 👋 https://example.com', request)
  expect((await send('Changed retry', request)).id).toBe(message.id)
  expect(message.sender_id).toBe(
    (await summary()).people.find((p) => p.key === 'neo')!.id,
  )
  expect(
    ((await rpc('chat_page', {})) as ChatMessage[]).filter(
      (m) => m.id === message.id,
    ),
  ).toHaveLength(1)
  expect(
    (
      await db.query<{ n: number }>(
        'select count(*)::int as n from private.chat_notification_events where message_id=$1',
        [message.id],
      )
    ).rows[0]?.n,
  ).toBe(1)
  const second = await send('Samtidigt', randomUUID(), sally)
  expect(second.seq).toBeGreaterThan(message.seq)
})
it('edits only own messages, rejects stale edit, and deletes text idempotently', async () => {
  const message = await send('Original')
  await expect(
    rpc(
      'chat_change',
      {
        message_id: message.id,
        message_body: 'Forbidden',
        expected_version: 1,
      },
      sally,
    ),
  ).rejects.toThrow(/egna/)
  const changed = (await rpc('chat_change', {
    message_id: message.id,
    message_body: 'Ändrat',
    expected_version: 1,
  })) as ChatMessage
  expect(changed.body).toBe('Ändrat')
  expect(changed.edited_at).toBeTruthy()
  await expect(
    rpc('chat_change', {
      message_id: message.id,
      message_body: 'Old',
      expected_version: 1,
    }),
  ).rejects.toThrow(/ändrats/)
  const deleted = (await rpc('chat_change', {
    message_id: message.id,
    message_body: '',
    expected_version: 2,
    remove_message: true,
  })) as ChatMessage
  expect(deleted.body).toBe('')
  expect(deleted.deleted_at).toBeTruthy()
  expect(
    (
      (await rpc('chat_change', {
        message_id: message.id,
        message_body: '',
        expected_version: 2,
        remove_message: true,
      })) as ChatMessage
    ).id,
  ).toBe(message.id)
})
it('keyset pages have stable order without duplicates across concurrent new sends', async () => {
  for (let i = 0; i < 43; i++) await send('Historik ' + i)
  const latest = (await rpc('chat_page', { page_limit: 40 })) as ChatMessage[]
  expect(latest).toHaveLength(40)
  const newer = await send('Nyare')
  const older = (await rpc('chat_page', {
    before_seq: latest[0]!.seq,
    page_limit: 40,
  })) as ChatMessage[]
  expect(older.length).toBeGreaterThan(0)
  expect(new Set([...older, ...latest].map((m) => m.id)).size).toBe(
    older.length + latest.length,
  )
  expect(older.at(-1)!.seq).toBeLessThan(latest[0]!.seq)
  expect(
    (
      (await rpc('chat_page', {
        after_seq: latest.at(-1)!.seq,
      })) as ChatMessage[]
    ).map((m) => m.id),
  ).toEqual([newer.id])
  await expect(rpc('chat_page', { page_limit: 101 })).rejects.toThrow(
    /sidindelning/,
  )
})
it('unread excludes own/deleted messages; read cursor is monotonic and cannot jump into future', async () => {
  let current = await summary()
  await rpc('chat_mark_read', { through_seq: current.last_message!.seq })
  const own = await send('Eget')
  expect((await summary()).unread).toBe(0)
  const incoming = await send('Inkommande', randomUUID(), sally)
  expect((await summary()).unread).toBe(1)
  await rpc('chat_mark_read', { through_seq: incoming.seq })
  await rpc('chat_mark_read', { through_seq: own.seq })
  expect((await summary()).last_read_seq).toBe(incoming.seq)
  expect((await summary()).unread).toBe(0)
  await expect(
    rpc('chat_mark_read', { through_seq: incoming.seq + 1000 }),
  ).rejects.toThrow(/läsmarkering/)
  const removed = await send('Bort', randomUUID(), sally)
  await rpc(
    'chat_change',
    {
      message_id: removed.id,
      message_body: '',
      expected_version: 1,
      remove_message: true,
    },
    sally,
  )
  current = await summary()
  expect(current.unread).toBe(0)
  expect(current.last_message?.id).toBe(incoming.id)
})
it('notification preference is private and per profile', async () => {
  await expect(rpc('chat_preferences', { enabled: false })).rejects.toThrow(
    /behörighet/,
  )
  expect((await summary()).chat_enabled).toBe(true)
  expect((await summary(sally)).chat_enabled).toBe(true)
  const foreign = await asCalendarRole(
    db,
    'authenticated',
    () => db.query('select * from public.notification_preferences'),
    sally,
  )
  expect(foreign.rows).toEqual([])
})
it('rejects empty/oversized sends; stores HTML as plain text', async () => {
  await expect(send(' ')).rejects.toThrow()
  await expect(send('x'.repeat(10001))).rejects.toThrow()
  const html = '<img src=x onerror=alert(1)><script>alert(1)</script>'
  expect((await send(html)).body).toBe(html)
})
it('denies anonymous RPC/table/outbox access and direct member writes', async () => {
  for (const table of [
    'chat_messages',
    'chat_read_states',
    'notification_preferences',
  ])
    await expect(
      asCalendarRole(db, 'anon', () =>
        db.query(`select * from public.${table}`),
      ),
    ).rejects.toThrow(/permission denied/)
  await expect(
    asCalendarRole(db, 'anon', () => db.query('select public.chat_summary()')),
  ).rejects.toThrow(/permission denied/)
  await expect(
    asCalendarRole(
      db,
      'authenticated',
      () => db.query('select * from private.chat_notification_events'),
      testUser,
    ),
  ).rejects.toThrow(/permission denied/)
  await expect(
    asCalendarRole(
      db,
      'authenticated',
      () => db.query("update public.chat_messages set body='Spoof'"),
      testUser,
    ),
  ).rejects.toThrow(/permission denied/)
})
it('isolates another family and rejects unregistered Auth identities', async () => {
  await expect(summary(other)).rejects.toThrow(/familjeidentitet/)
  const fam = randomUUID()
  await db.query("insert into public.families(id,name) values($1,'Other')", [
    fam,
  ])
  await db.query(
    "insert into public.profiles(family_id,auth_user_id,display_name,profile_key) values($1,$2,'Neo','neo')",
    [fam, other],
  )
  expect(await rpc('chat_page', {}, other)).toEqual([])
  expect((await summary(other)).unread).toBe(0)
  const message = await send('Private')
  await expect(
    rpc(
      'chat_change',
      { message_id: message.id, message_body: 'No', expected_version: 1 },
      other,
    ),
  ).rejects.toThrow(/egna/)
  const otherMessage = await send('Other family', randomUUID(), other)
  expect(
    ((await rpc('chat_page', {})) as ChatMessage[]).some(
      (m) => m.id === otherMessage.id,
    ),
  ).toBe(false)
})
