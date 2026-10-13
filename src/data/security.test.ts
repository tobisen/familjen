// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
let db: PGlite
const familyA = '00000000-0000-0000-0000-000000000001'
const familyB = '00000000-0000-0000-0000-000000000002'
const userA = '00000000-0000-0000-0000-000000000011'
const userB = '00000000-0000-0000-0000-000000000012'
const outsider = '00000000-0000-0000-0000-000000000013'
const profileA = '00000000-0000-0000-0000-000000000021'
const profileB = '00000000-0000-0000-0000-000000000022'
async function asUser(sql: string, user = userA, role = 'authenticated') {
  await db.exec(
    `set role ${role}; select set_config('test.uid', '${user}', false);`,
  )
  try {
    return await db.query(sql)
  } finally {
    await db.exec('reset role')
  }
}
beforeAll(async () => {
  db = new PGlite()
  // Supabase-provided auth schema and roles, emulated only for SQL policy tests.
  await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
 grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;`)
  await db.exec(
    readFileSync('supabase/migrations/202610130001_phase0.sql', 'utf8'),
  )
  await db.exec(`insert into auth.users values ('${userA}'),('${userB}'),('${outsider}');
 insert into public.families values ('${familyA}','Test A'),('${familyB}','Test B');
 insert into public.profiles values ('${profileA}','${familyA}','${userA}','Test A'),('${profileB}','${familyB}','${userB}','Test B');
 insert into public.tasks(family_id,title) values ('${familyA}','Test A'),('${familyB}','Test B');
 insert into public.push_subscriptions(family_id,profile_id,endpoint,subscription) values ('${familyA}','${profileA}','https://example.invalid/test','{}');`)
}, 30000)
afterAll(async () => db?.close())
describe('migration and RLS in PostgreSQL (Auth emulated)', () => {
  it('enables RLS on all 10 tables', async () => {
    const r = await db.query(
      "select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' and relrowsecurity",
    )
    expect(r.rows).toHaveLength(10)
  })
  it('denies all anonymous table reads', async () => {
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
    ])
      await expect(
        asUser(`select * from public.${t}`, '', 'anon'),
      ).rejects.toThrow(/permission denied/)
  })
  it('denies non-member data', async () => {
    expect(
      (await asUser('select * from public.tasks', outsider)).rows,
    ).toHaveLength(0)
    await expect(
      asUser(
        `insert into public.tasks(family_id,title) values ('${familyA}','Denied')`,
        outsider,
      ),
    ).rejects.toThrow(/row-level security/)
  })
  it('isolates families', async () => {
    const r = await asUser('select title from public.tasks')
    expect(r.rows).toEqual([{ title: 'Test A' }])
    expect(
      (await asUser('select display_name from public.profiles')).rows,
    ).toEqual([{ display_name: 'Test A' }])
  })
  it('blocks membership provisioning', async () => {
    await expect(
      asUser(
        `update public.profiles set auth_user_id='${outsider}' where id='${profileA}'`,
      ),
    ).rejects.toThrow(/permission denied/)
  })
  it('blocks cross-family insert and reassignment', async () => {
    await expect(
      asUser(
        `insert into public.tasks(family_id,title) values ('${familyB}','Denied')`,
      ),
    ).rejects.toThrow(/row-level security/)
    await expect(
      asUser(
        `update public.tasks set family_id='${familyB}' where family_id='${familyA}'`,
      ),
    ).rejects.toThrow(/row-level security/)
  })
  it('blocks impersonation and cross-family foreign keys', async () => {
    await expect(
      asUser(
        `insert into public.chat_messages(family_id,sender_id,body) values ('${familyA}','${profileB}','Denied')`,
      ),
    ).rejects.toThrow()
    await expect(
      asUser(
        `insert into public.tasks(family_id,title,assigned_to) values ('${familyA}','Denied','${profileB}')`,
      ),
    ).rejects.toThrow(/foreign key/)
  })
  it('allows own position and rejects writing another profile', async () => {
    await asUser(
      `insert into public.positions(profile_id,family_id,latitude,longitude,accuracy) values ('${profileA}','${familyA}',0,0,10)`,
    )
    await expect(
      asUser(
        `insert into public.positions(profile_id,family_id,latitude,longitude,accuracy) values ('${profileB}','${familyB}',0,0,10)`,
      ),
    ).rejects.toThrow(/row-level security/)
  })
  it('hides push endpoints from other family members', async () => {
    const sameFamilyUser = '00000000-0000-0000-0000-000000000014'
    await db.exec(
      `insert into auth.users values ('${sameFamilyUser}'); insert into public.profiles(family_id,auth_user_id,display_name) values ('${familyA}','${sameFamilyUser}','Test sibling')`,
    )
    expect(
      (await asUser('select * from public.push_subscriptions', sameFamilyUser))
        .rows,
    ).toHaveLength(0)
    expect(
      (await asUser('select * from public.push_subscriptions')).rows,
    ).toHaveLength(1)
  })
  it('uses stable school IDs for duplicate-free updates', async () => {
    const q = `insert into public.school_lessons(family_id,student_id,external_id,weekday,starts_at,ends_at,subject,term_start,term_end) values ('${familyA}','${profileA}','test',1,'10:00','11:00','Fixture','2026-01-01','2026-06-01') on conflict(family_id,student_id,external_id) do update set subject='Updated'`
    await asUser(q)
    await asUser(q)
    const r = await asUser('select subject from public.school_lessons')
    expect(r.rows).toEqual([{ subject: 'Updated' }])
  })
})
