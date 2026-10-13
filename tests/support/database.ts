export const testUser = '00000000-0000-0000-0000-000000000011'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
export async function calendarDatabase(enabled = true) {
  const db = new PGlite()
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`)
  for (const f of [
    '202610130001_phase0.sql',
    '202610130002_open_calendar.sql',
    '202610130003_private_calendar.sql',
    '202610130004_registration_codes.sql',
  ])
    await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'))
  if (enabled) {
    await db.exec(
      `insert into auth.users values ('${testUser}'); update public.profiles set auth_user_id='${testUser}' where profile_key='neo'`,
    )
  }
  return db
}
export async function asCalendarRole<T>(
  db: PGlite,
  role: 'anon' | 'authenticated',
  fn: () => Promise<T>,
  user = '',
) {
  await db.exec(`set role ${role}`)
  await db.query("select set_config('test.uid',$1,false)", [user])
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}
export async function calendarRpc(
  db: PGlite,
  name: string,
  args: Record<string, unknown>,
  user = testUser,
) {
  const specs: Record<string, { sql: string; values: unknown[] }> = {
    calendar_snapshot: {
      sql: 'select public.calendar_snapshot() as result',
      values: [],
    },
    calendar_save: {
      sql: 'select public.calendar_save($1::jsonb,$2::uuid,$3::integer) as result',
      values: [
        JSON.stringify(args.payload),
        args.event_id ?? null,
        args.expected_version ?? null,
      ],
    },
    calendar_delete: {
      sql: 'select public.calendar_delete($1::uuid,$2::integer) as result',
      values: [args.event_id, args.expected_version],
    },
    calendar_import: {
      sql: 'select public.calendar_import($1::jsonb) as result',
      values: [JSON.stringify(args.lessons)],
    },
  }
  specs.calendar_identity = {
    sql: 'select public.calendar_identity() as result',
    values: [],
  }
  const spec = specs[name]
  if (!spec) throw new Error('Unknown RPC')
  return asCalendarRole(
    db,
    'authenticated',
    async () =>
      (await db.query<{ result: unknown }>(spec.sql, spec.values)).rows[0]
        ?.result,
    user,
  )
}
