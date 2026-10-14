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
    '202610130005_nonexpiring_codes.sql',
    '202610130006_family_lists.sql',
    '202610140007_family_chat.sql',
    '202610140008_school_administration.sql',
    '202610140009_school_validation.sql',
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
  specs.school_snapshot = {
    sql: 'select public.school_snapshot() as result',
    values: [],
  }
  specs.school_save = {
    sql: 'select public.school_save($1::jsonb,$2::integer,$3::boolean,$4::boolean) as result',
    values: [
      JSON.stringify(args.payload),
      args.expected_version ?? null,
      args.activate ?? false,
      args.replace_missing ?? false,
    ],
  }
  specs.lists_snapshot = {
    sql: 'select public.lists_snapshot() as result',
    values: [],
  }
  specs.lists_save = {
    sql: 'select public.lists_save($1,$2::jsonb,$3::uuid,$4::integer,$5::uuid) as result',
    values: [
      args.kind,
      JSON.stringify(args.payload),
      args.item_id ?? null,
      args.expected_version ?? null,
      args.request_id ?? null,
    ],
  }
  specs.lists_set_done = {
    sql: 'select public.lists_set_done($1,$2::uuid,$3::boolean,$4::integer) as result',
    values: [args.kind, args.item_id, args.done, args.expected_version],
  }
  specs.lists_delete = {
    sql: 'select public.lists_delete($1,$2::uuid,$3::integer) as result',
    values: [args.kind, args.item_id, args.expected_version],
  }
  specs.calendar_identity = {
    sql: 'select public.calendar_identity() as result',
    values: [],
  }
  specs.chat_page = {
    sql: 'select public.chat_page($1::bigint,$2::bigint,$3::integer) as result',
    values: [
      args.before_seq ?? null,
      args.after_seq ?? null,
      args.page_limit ?? 40,
    ],
  }
  specs.chat_summary = {
    sql: 'select public.chat_summary() as result',
    values: [],
  }
  specs.chat_send = {
    sql: 'select to_jsonb(public.chat_send($1,$2::uuid)) as result',
    values: [args.message_body, args.request_id],
  }
  specs.chat_change = {
    sql: 'select to_jsonb(public.chat_change($1::uuid,$2,$3::integer,$4::boolean)) as result',
    values: [
      args.message_id,
      args.message_body,
      args.expected_version,
      args.remove_message ?? false,
    ],
  }
  specs.chat_mark_read = {
    sql: 'select public.chat_mark_read($1::bigint) as result',
    values: [args.through_seq],
  }
  specs.chat_preferences = {
    sql: 'select public.chat_preferences($1::boolean) as result',
    values: [args.enabled],
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
