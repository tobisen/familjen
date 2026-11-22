// @vitest-environment node
import { beforeAll, afterAll, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  calendarDatabase,
  calendarRpc,
  asCalendarRole,
  testUser,
} from '../../tests/support/database'
import {
  validatePersonalPlan,
  type SavedPersonalWeek,
} from '../domain/personalWeek'
let db: PGlite
const tobias = '00000000-0000-0000-0000-000000000013',
  sally = '00000000-0000-0000-0000-000000000012',
  stranger = '00000000-0000-0000-0000-000000000014'
const base = validatePersonalPlan({
  year: 2026,
  week: 48,
  weekType: 'barnfri',
  days: [{ date: '2026-11-23', training: ['Promenad'] }],
  tasks: ['Boka tid'],
})
async function save(
  payload: unknown,
  version: number | null = null,
  request_id = crypto.randomUUID(),
  user = tobias,
) {
  return (await calendarRpc(
    db,
    'personal_week_save',
    { payload, expected_version: version, request_id },
    user,
  )) as SavedPersonalWeek
}
async function snapshot(user = tobias) {
  return (await calendarRpc(
    db,
    'personal_week_snapshot',
    { target_year: 2026, target_week: 48 },
    user,
  )) as SavedPersonalWeek
}
beforeAll(async () => {
  db = await calendarDatabase()
  await db.exec(
    `insert into auth.users values ('${tobias}'),('${sally}'),('${stranger}'); update public.profiles set auth_user_id='${tobias}' where profile_key='tobias'; update public.profiles set auth_user_id='${sally}' where profile_key='sally';`,
  )
}, 30000)
afterAll(async () => db.close())
it('binds access to existing stable profile, supports idempotent retries and never silently replaces', async () => {
  const request = crypto.randomUUID()
  const first = await save(base, null, request)
  expect(first.owner_id).toBe(
    await calendarRpc(db, 'personal_week_owner', {}, tobias),
  )
  expect(first.days).toHaveLength(7)
  expect((await save(base, null, request)).id).toBe(first.id)
  expect((await snapshot()).version).toBe(1)
  await expect(save(base)).rejects.toThrow(/finns redan/)
  await expect(save({ ...base, focus: ['Annat'] }, 1, request)).rejects.toThrow(
    /Import-ID/,
  )
  const replacement = await save({ ...base, focus: ['Ersatt'] }, 1)
  expect(replacement.id).toBe(first.id)
  expect(replacement.version).toBe(2)
  expect(replacement.tasks).toHaveLength(1)
  await expect(save(base, 1)).rejects.toThrow(/ändrats/)
})
it('preserves the previous plan on late validation failure after delete/update work', async () => {
  const before = await snapshot()
  await expect(
    save(
      { ...base, tasks: [{ task: 'Fel', category: 'unknown', done: false }] },
      before.version,
    ),
  ).rejects.toThrow()
  expect(await snapshot()).toEqual(before)
  await expect(
    save({ ...base, tasks: [base.tasks[0], base.tasks[0]] }, before.version),
  ).rejects.toThrow()
  expect(await snapshot()).toEqual(before)
})
it('edits items, preserves IDs and created_at, reorders and toggles tasks both ways', async () => {
  let plan = await snapshot()
  const itemId = plan.days[0]!.items[0]!.id
  const created = await db.query(
    'select created_at from public.personal_day_items where id=$1',
    [itemId],
  )
  plan.days[0]!.items[0]!.content = 'Styrka'
  plan.days[0]!.items.push({
    category: 'training',
    content: 'Rörlighet',
    done: false,
  })
  plan.tasks[0]!.done = true
  plan = await save(plan, plan.version)
  expect(plan.days[0]!.items[0]!.id).toBe(itemId)
  expect(plan.tasks[0]!.done).toBe(true)
  expect(
    (
      await db.query(
        'select created_at from public.personal_day_items where id=$1',
        [itemId],
      )
    ).rows,
  ).toEqual(created.rows)
  plan.days[0]!.items.reverse()
  plan.tasks[0]!.done = false
  plan = await save(plan, plan.version)
  expect(plan.days[0]!.items.map((i) => i.content)).toEqual([
    'Rörlighet',
    'Styrka',
  ])
  expect(plan.tasks[0]!.done).toBe(false)
  plan.days[0]!.items.splice(0, 1)
  expect((await save(plan, plan.version)).days[0]!.items).toHaveLength(1)
})
it('denies Neo, Sally, unregistered and anonymous callers including direct APIs and forged ownership', async () => {
  const current = await snapshot()
  for (const user of [testUser, sally, stranger]) {
    expect(await calendarRpc(db, 'personal_week_owner', {}, user)).toBeNull()
    await expect(snapshot(user)).rejects.toThrow(/privat/)
    await expect(
      save(
        { ...base, owner_id: current.owner_id },
        current.version,
        crypto.randomUUID(),
        user,
      ),
    ).rejects.toThrow(/privat/)
    await asCalendarRole(
      db,
      'authenticated',
      async () => {
        for (const table of [
          'personal_weeks',
          'personal_week_days',
          'personal_day_items',
          'personal_week_tasks',
        ]) {
          expect(
            (await db.query(`select * from public.${table}`)).rows,
          ).toEqual([])
          await expect(db.exec(`delete from public.${table}`)).rejects.toThrow(
            /permission denied/,
          )
          await expect(
            db.exec(
              `update public.${table} set owner_id='${current.owner_id}'`,
            ),
          ).rejects.toThrow(/permission denied/)
          await expect(
            db.exec(
              `insert into public.${table}(owner_id) values('${current.owner_id}')`,
            ),
          ).rejects.toThrow(/permission denied/)
        }
      },
      user,
    )
  }
  await expect(
    save({ ...base, owner_id: crypto.randomUUID() }, current.version),
  ).rejects.toThrow(/ägare/)
  await asCalendarRole(db, 'anon', async () => {
    await expect(
      db.exec('select public.personal_week_owner()'),
    ).rejects.toThrow(/permission denied/)
    await expect(
      db.exec('select * from public.personal_weeks'),
    ).rejects.toThrow(/permission denied/)
  })
  await asCalendarRole(
    db,
    'authenticated',
    async () => {
      expect(
        (await db.query('select * from public.personal_weeks')).rows,
      ).toHaveLength(1)
      await expect(
        db.exec("update public.personal_weeks set focus='[]'"),
      ).rejects.toThrow(/permission denied/)
    },
    tobias,
  )
})
it('validates ISO boundaries, duplicates, relational ownership and cross-week item forgery on server', async () => {
  const before = await snapshot()
  for (const payload of [
    { ...base, year: 2025, week_number: 53 },
    { ...base, days: base.days.map(() => base.days[0]) },
    {
      ...base,
      days: base.days.map((d, i) => (i ? d : { ...d, date: '2026-11-31' })),
    },
    { ...base, weekly_summary: { economy: 5 } },
  ])
    await expect(save(payload, before.version)).rejects.toThrow()
  const other = await save(
    validatePersonalPlan({
      year: 2026,
      week: 53,
      weekType: 'barnfri',
      days: [{ date: '2027-01-01', work: ['Jobb'] }],
    }),
  )
  const forged = structuredClone(before)
  forged.days[0]!.items = other.days[4]!.items
  await expect(save(forged, before.version)).rejects.toThrow(/post-ID/)
  expect(await snapshot()).toEqual(before)
  await expect(
    db.query(
      'insert into public.personal_week_days(week_id,owner_id,date) values($1,$2,$3)',
      [before.id, crypto.randomUUID(), '2026-11-23'],
    ),
  ).rejects.toThrow()
  const shared = (await calendarRpc(db, 'lists_snapshot', {})) as {
    tasks: unknown[]
  }
  expect(shared.tasks).toHaveLength(0)
})
