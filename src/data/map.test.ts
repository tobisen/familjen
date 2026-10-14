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
import type { MapSnapshot } from '../domain/location'
let db: PGlite
const tobias = randomUUID(),
  sally = randomUUID(),
  other = randomUUID(),
  family = randomUUID()
const rpc = (
  name: string,
  args: Record<string, unknown> = {},
  user = testUser,
) => calendarRpc(db, name, args, user)
const point = (offset = 0) => ({
  latitude: 59.86,
  longitude: 17.64,
  accuracy: 12,
  recorded_at: new Date(Date.now() + offset).toISOString(),
})
beforeAll(async () => {
  db = await calendarDatabase()
  await db.exec(
    `insert into auth.users values('${sally}'),('${other}'),('${tobias}');update public.profiles set auth_user_id='${sally}' where profile_key='sally';update public.profiles set auth_user_id='${tobias}' where profile_key='tobias';insert into public.families(id,name) values('${family}','Other');insert into public.profiles(family_id,auth_user_id,profile_key,display_name) values('${family}','${other}','neo','Other');`,
  )
}, 30000)
afterAll(async () => db.close())
it('upserts only the session owner, rejects stale/future data and throttles reports', async () => {
  expect(await rpc('map_report', point(-10000))).toEqual({ accepted: true })
  const initial = (await rpc('map_snapshot')) as MapSnapshot
  expect(initial.positions).toHaveLength(1)
  expect(
    initial.people.find((p) => p.id === initial.positions[0]!.profile_id)?.key,
  ).toBe('neo')
  expect(await rpc('map_report', point(-11000))).toEqual({ accepted: false })
  expect(await rpc('map_report', point())).toEqual({ accepted: false })
  await db.exec(
    "update public.positions set received_at=now()-interval '10 seconds'",
  )
  expect(await rpc('map_report', { ...point(), latitude: 59.87 })).toEqual({
    accepted: true,
  })
  expect(((await rpc('map_snapshot')) as MapSnapshot).positions).toHaveLength(1)
  await expect(rpc('map_report', point(60000))).rejects.toThrow(/ogiltig/)
  await expect(rpc('map_report', point(-180000))).rejects.toThrow(/gammal/)
  await expect(
    rpc('map_report', { ...point(), latitude: 100 }),
  ).rejects.toThrow(/ogiltig/)
})
it('isolates families and denies anonymous reads, RPCs and direct writes', async () => {
  expect(
    ((await rpc('map_snapshot', {}, other)) as MapSnapshot).positions,
  ).toEqual([])
  await rpc('map_report', { ...point(), latitude: 10 }, other)
  expect(
    ((await rpc('map_snapshot')) as MapSnapshot).positions[0]!.latitude,
  ).toBe(59.87)
  for (const query of [
    'select * from public.positions',
    'select public.map_snapshot()',
    'select public.map_report(0,0,1,now())',
    'select public.map_help(null)',
  ])
    await expect(
      asCalendarRole(db, 'anon', () => db.query(query)),
    ).rejects.toThrow(/permission denied/)
  await expect(
    asCalendarRole(
      db,
      'authenticated',
      () => db.query('update public.positions set latitude=0'),
      testUser,
    ),
  ).rejects.toThrow(/permission denied/)
})
it('help is idempotent, private, prioritized, and reports missing push devices honestly', async () => {
  const request = randomUUID(),
    args = { request_id: request, ...point() }
  const id = await rpc('map_help', args)
  expect(await rpc('map_help', args)).toBe(id)
  const messages = (await rpc('chat_page')) as {
    id: string
    kind: string
    map_path: string
    body: string
  }[]
  expect(messages.find((m) => m.id === id)).toMatchObject({ kind: 'help' })
  expect(messages.find((m) => m.id === id)?.map_path).toMatch(/^\/karta\?help=/)
  const jobs = await db.query<{
    kind: string
    payload: { body: string; path: string }
  }>('select kind,payload from private.push_jobs where object_id=$1', [id])
  expect(jobs.rows).toHaveLength(2)
  for (const job of jobs.rows) {
    expect(job.kind).toBe('help')
    expect(job.payload.body).not.toContain('59.86')
    expect(job.payload.path).not.toContain('59.86')
  }
  expect(await rpc('map_help_status', { message_id: id })).toMatchObject([
    { devices: 0 },
    { devices: 0 },
  ])
  await expect(
    rpc('map_help_status', { message_id: id }, other),
  ).rejects.toThrow(/finns inte/)
  await expect(
    rpc('map_help_position', { message_id: id }, other),
  ).rejects.toThrow(/finns inte/)
  expect(await rpc('map_help_position', { message_id: id })).toMatchObject({
    position: { latitude: 59.86, longitude: 17.64 },
  })
  await expect(
    rpc('map_help', { request_id: randomUUID(), ...point() }),
  ).rejects.toThrow(/minut/)
  await db.query(
    "update private.push_jobs set expires_at=now()-interval '1 minute' where object_id=$1",
    [id],
  )
  expect(await rpc('map_help_status', { message_id: id })).toMatchObject([
    { expired: true },
    { expired: true },
  ])
  await rpc('chat_change', {
    message_id: id,
    message_body: '',
    expected_version: 1,
    remove_message: true,
  })
  expect(
    (
      await db.query(
        'select help_position,map_path from public.chat_messages where id=$1',
        [id],
      )
    ).rows,
  ).toEqual([{ help_position: null, map_path: null }])
  expect(
    (
      await db.query<{ canceled: boolean }>(
        'select canceled from private.push_jobs where object_id=$1',
        [id],
      )
    ).rows.every((j) => j.canceled),
  ).toBe(true)
})
it('allows confirmed help without GPS and explicitly labels old coordinates', async () => {
  const none = await rpc('map_help', { request_id: randomUUID() }, sally)
  expect(
    ((await rpc('chat_page')) as { id: string; body: string }[]).find(
      (m) => m.id === none,
    )?.body,
  ).toContain('Ingen GPS-position')
  const old = await rpc(
    'map_help',
    { request_id: randomUUID(), ...point(-3600000) },
    other,
  )
  expect(
    (
      (await rpc('chat_page', {}, other)) as { id: string; body: string }[]
    ).find((m) => m.id === old)?.body,
  ).toContain('äldre än två minuter')
})
