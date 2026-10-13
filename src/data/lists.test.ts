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
import type { ListsSnapshot, TaskInput, ShoppingInput } from '../domain/lists'
let db: PGlite
const sally = '00000000-0000-0000-0000-000000000012',
  outsider = '00000000-0000-0000-0000-000000000013'
const task: TaskInput = {
  title: 'Testuppgift',
  description: 'Beskrivning',
  deadline: '2026-01-31',
  priority: 'high',
  assigned_ids: ['neo', 'sally'],
  recurrence: 'monthly',
  reminder_days: 1,
}
const item: ShoppingInput = { title: 'Testvara', amount: 2.5, unit: 'kg' }
const rpc = (fn: string, args: Record<string, unknown> = {}, user = testUser) =>
  calendarRpc(db, fn, args, user)
const snapshot = async (user = testUser) =>
  (await rpc('lists_snapshot', {}, user)) as ListsSnapshot
const create = (
  kind: string,
  payload: TaskInput | ShoppingInput,
  request = randomUUID(),
) =>
  rpc('lists_save', { kind, payload, request_id: request }) as Promise<string>
beforeAll(async () => {
  db = await calendarDatabase()
  await db.exec(
    `insert into auth.users values('${sally}'),('${outsider}');update public.profiles set auth_user_id='${sally}' where profile_key='sally';`,
  )
}, 30000)
afterAll(async () => db.close())
it('creates tasks with multiple assignees and server creator; retry does not duplicate', async () => {
  const request = randomUUID(),
    id = await create('task', task, request)
  expect(
    await create('task', { ...task, title: 'Do not overwrite' }, request),
  ).toBe(id)
  const row = (await snapshot()).tasks.find((t) => t.id === id)!
  expect(row).toMatchObject({
    title: task.title,
    assigned_ids: ['neo', 'sally'],
    version: 1,
    priority: 'high',
    reminder_days: 1,
  })
  expect(row.created_by).toBe(
    (await snapshot()).people.find((p) => p.key === 'neo')!.id,
  )
  expect((await snapshot()).tasks.filter((t) => t.id === id)).toHaveLength(1)
})
it('edits tasks and rejects stale updates across family members', async () => {
  const id = await create('task', task)
  await rpc('lists_save', {
    kind: 'task',
    payload: { ...task, title: 'Ändrad', assigned_ids: ['tobias'] },
    item_id: id,
    expected_version: 1,
  })
  await expect(
    rpc(
      'lists_save',
      { kind: 'task', payload: task, item_id: id, expected_version: 1 },
      sally,
    ),
  ).rejects.toThrow(/ändrats/)
  expect((await snapshot(sally)).tasks.find((t) => t.id === id)).toMatchObject({
    title: 'Ändrad',
    assigned_ids: ['tobias'],
    version: 2,
  })
})
it('completion is idempotent and recurrence preserves monthly anchor and assignees', async () => {
  const id = await create('task', task)
  await rpc(
    'lists_set_done',
    { kind: 'task', item_id: id, done: true, expected_version: 1 },
    sally,
  )
  await rpc('lists_set_done', {
    kind: 'task',
    item_id: id,
    done: true,
    expected_version: 1,
  })
  let rows = (await snapshot()).tasks
  expect(rows.find((t) => t.id === id)).toMatchObject({
    completed: true,
    version: 2,
    completed_by: (await snapshot()).people.find((p) => p.key === 'sally')!.id,
  })
  const next = rows.find((t) => t.recurrence_parent === id)!
  expect(next).toMatchObject({
    deadline: '2026-02-28',
    assigned_ids: ['neo', 'sally'],
    completed: false,
  })
  await rpc('lists_set_done', {
    kind: 'task',
    item_id: next.id,
    done: true,
    expected_version: 1,
  })
  rows = (await snapshot()).tasks
  expect(rows.find((t) => t.recurrence_parent === next.id)?.deadline).toBe(
    '2026-03-31',
  )
  await rpc('lists_set_done', {
    kind: 'task',
    item_id: id,
    done: false,
    expected_version: 2,
  })
  await rpc('lists_set_done', {
    kind: 'task',
    item_id: id,
    done: true,
    expected_version: 3,
  })
  expect(
    (await snapshot()).tasks.filter((t) => t.recurrence_parent === id),
  ).toHaveLength(1)
})
it.each([
  ['daily', '2026-04-01'],
  ['weekly', '2026-04-07'],
  ['monthly', '2026-04-30'],
])('advances %s without timezone conversion', async (frequency, expected) => {
  const result = await db.query<{ due: string }>(
    "select public.task_next_deadline('2026-03-31',$1,'2026-03-31')::text as due",
    [frequency],
  )
  expect(result.rows[0]!.due).toBe(expected)
})
it('monthly recurrence handles leap years and Swedish DST dates as calendar dates', async () => {
  const r = await db.query<{ leap: string; spring: string; autumn: string }>(
    "select public.task_next_deadline('2028-01-31','monthly','2028-01-31')::text as leap, public.task_next_deadline('2026-03-28','daily','2026-03-28')::text as spring,public.task_next_deadline('2026-10-24','daily','2026-10-24')::text as autumn",
  )
  expect(r.rows[0]).toEqual({
    leap: '2028-02-29',
    spring: '2026-03-29',
    autumn: '2026-10-25',
  })
})
it('purchases once, records server identity, restores and rejects conflicting opposite changes', async () => {
  const request = randomUUID(),
    id = await create('shopping', item, request)
  expect(await create('shopping', item, request)).toBe(id)
  await rpc(
    'lists_set_done',
    { kind: 'shopping', item_id: id, done: true, expected_version: 1 },
    sally,
  )
  await rpc('lists_set_done', {
    kind: 'shopping',
    item_id: id,
    done: true,
    expected_version: 1,
  })
  let row = (await snapshot()).shopping.find((s) => s.id === id)!
  expect(row).toMatchObject({
    purchased: true,
    version: 2,
    purchased_by: (await snapshot()).people.find((p) => p.key === 'sally')!.id,
  })
  expect(row.purchased_at).toBeTruthy()
  await expect(
    rpc('lists_set_done', {
      kind: 'shopping',
      item_id: id,
      done: false,
      expected_version: 1,
    }),
  ).rejects.toThrow(/ändrats/)
  await rpc('lists_set_done', {
    kind: 'shopping',
    item_id: id,
    done: false,
    expected_version: 2,
  })
  row = (await snapshot()).shopping.find((s) => s.id === id)!
  expect(row).toMatchObject({
    purchased: false,
    purchased_by: null,
    purchased_at: null,
    version: 3,
  })
})
it('edits and soft deletes shopping and tasks with version protection', async () => {
  for (const kind of ['task', 'shopping']) {
    const id = await create(kind, kind === 'task' ? task : item)
    const payload =
      kind === 'task'
        ? { ...task, title: 'Redigerad' }
        : { ...item, title: 'Redigerad', amount: 3 }
    await rpc('lists_save', { kind, item_id: id, expected_version: 1, payload })
    await expect(
      rpc('lists_delete', { kind, item_id: id, expected_version: 1 }),
    ).rejects.toThrow(/ändrats/)
    await rpc('lists_delete', { kind, item_id: id, expected_version: 2 })
    const data = await snapshot()
    expect(
      (kind === 'task' ? data.tasks : data.shopping).find((t) => t.id === id),
    ).toBeUndefined()
  }
})
it('validates titles, quantities, assignments, recurrence and reminder values server-side', async () => {
  for (const payload of [
    { ...task, title: '' },
    { ...task, assigned_ids: ['alien'] },
    { ...task, assigned_ids: ['neo', 'neo'] },
    { ...task, recurrence: 'hourly' },
    { ...task, deadline: null },
    { ...task, deadline: '2026-02-31' },
    { ...task, reminder_days: -1 },
  ])
    await expect(create('task', payload as TaskInput)).rejects.toThrow()
  for (const payload of [
    { ...item, amount: 0 },
    { ...item, amount: -1 },
    { ...item, unit: 'x'.repeat(41) },
  ])
    await expect(create('shopping', payload)).rejects.toThrow()
})
it('denies anonymous reads/RPCs, outsiders, direct writes, forged identities and foreign-family IDs', async () => {
  for (const table of ['tasks', 'task_assignees', 'shopping_items']) {
    await expect(
      asCalendarRole(db, 'anon', () =>
        db.query(`select * from public.${table}`),
      ),
    ).rejects.toThrow(/permission denied/)
  }
  await expect(
    asCalendarRole(db, 'anon', () =>
      db.query('select public.lists_snapshot()'),
    ),
  ).rejects.toThrow(/permission denied/)
  await expect(rpc('lists_snapshot', {}, outsider)).rejects.toThrow(
    /familjeidentitet/,
  )
  const id = await create('task', task)
  await expect(
    asCalendarRole(
      db,
      'authenticated',
      () => db.query("update public.tasks set title='spoof' where id=$1", [id]),
      testUser,
    ),
  ).rejects.toThrow(/permission denied/)
  const foreignFamily = randomUUID(),
    foreignProfile = randomUUID()
  await db.query("insert into public.families(id,name) values($1,'Other')", [
    foreignFamily,
  ])
  await db.query(
    "insert into public.profiles(id,family_id,auth_user_id,display_name,profile_key) values($1,$2,$3,'Other','neo')",
    [foreignProfile, foreignFamily, outsider],
  )
  expect((await snapshot(outsider)).tasks).toEqual([])
  await expect(
    rpc(
      'lists_set_done',
      { kind: 'task', item_id: id, done: true, expected_version: 1 },
      outsider,
    ),
  ).rejects.toThrow(/inte längre/)
  await expect(
    rpc(
      'lists_save',
      {
        kind: 'task',
        item_id: id,
        expected_version: 1,
        payload: { ...task, assigned_ids: ['neo'] },
      },
      outsider,
    ),
  ).rejects.toThrow(/ändrats/)
  await expect(
    rpc(
      'lists_delete',
      { kind: 'task', item_id: id, expected_version: 1 },
      outsider,
    ),
  ).rejects.toThrow(/ändrats/)
  const forgedId = (await rpc('lists_save', {
    kind: 'shopping',
    request_id: randomUUID(),
    payload: { ...item, family_id: foreignFamily, created_by: foreignProfile },
  })) as string
  expect(
    (await snapshot()).shopping.find((s) => s.id === forgedId)?.created_by,
  ).not.toBe(foreignProfile)
  expect((await snapshot(outsider)).shopping).toEqual([])
})
