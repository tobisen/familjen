// Real Auth/PostgREST checks. Input and session tokens stay in memory.
import { createClient } from '@supabase/supabase-js'
let raw = ''
for await (const part of process.stdin) raw += part
const input = JSON.parse(raw)
raw = ''
const clients = []
try {
  for (const who of ['member', 'other', 'outsider']) {
    const c = createClient(input.url, input.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
    const { error } = await c.auth.verifyOtp({
      token_hash: input.tokens[who],
      type: 'magiclink',
    })
    if (error) throw new Error('Identity verification failed')
    clients.push(c)
  }
  const [member, other, outsider] = clients
  const inputEvent = {
    title: 'RLS verification ' + crypto.randomUUID(),
    description: 'Isolated verification fixture',
    location: '',
    starts_at: '2026-10-13T08:00:00Z',
    ends_at: '2026-10-13T09:00:00Z',
    all_day: false,
    participant_ids: ['neo'],
    category: 'family',
    recurrence: null,
    exception_dates: [],
    family_id: input.otherFamily,
  }
  const save = await member.rpc('calendar_save', {
    payload: inputEvent,
    event_id: null,
    expected_version: null,
  })
  if (save.error) throw new Error('Member save failed')
  const id = save.data
  const snapshot = await other.rpc('calendar_snapshot')
  if (snapshot.error || snapshot.data.activities.some((a) => a.id === id))
    throw new Error('Cross-family read')
  const identity = await outsider.rpc('calendar_identity')
  if (identity.error || identity.data !== null)
    throw new Error('Unregistered identity accepted')
  for (const [name, args] of [
    ['calendar_snapshot', {}],
    [
      'calendar_save',
      { payload: inputEvent, event_id: null, expected_version: null },
    ],
    ['calendar_delete', { event_id: id, expected_version: 1 }],
    ['calendar_import', { lessons: [] }],
  ])
    if (!(await outsider.rpc(name, args)).error)
      throw new Error('Nonmember RPC accepted')
  for (const table of [
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
    'private_calendar_events',
    'private_school_lessons',
    'private_calendar_people',
    'private_calendar_settings',
  ]) {
    const read = await outsider.from(table).select('*')
    if (read.error || read.data.length)
      throw new Error('Nonmember table isolation failed')
  }
  if (
    !(
      await other.rpc('calendar_save', {
        payload: inputEvent,
        event_id: id,
        expected_version: 1,
      })
    ).error
  )
    throw new Error('Cross-family update accepted')
  if (
    !(await other.rpc('calendar_delete', { event_id: id, expected_version: 1 }))
      .error
  )
    throw new Error('Cross-family delete accepted')
  if (
    !(
      await member
        .from('profiles')
        .update({ profile_key: 'sally' })
        .eq('auth_user_id', input.memberUser)
    ).error
  )
    throw new Error('Profile escalation accepted')
  const own = await member.rpc('calendar_snapshot')
  const event = own.data.activities.find((a) => a.id === id)
  if (
    event.family_id === input.otherFamily ||
    event.created_by !== input.memberProfile
  )
    throw new Error('Forged family/author accepted')
  await member.rpc('calendar_delete', {
    event_id: id,
    expected_version: event.version,
  })
  console.log(
    JSON.stringify({
      realAuthPostgrest: true,
      nonmemberTablesIsolated: 14,
      nonmemberRpcsDenied: 4,
      crossFamilyReadUpdateDeleteDenied: true,
      serverFamilyAndAuthor: true,
      profileEscalationDenied: true,
    }),
  )
} catch {
  console.error(
    'Live RLS verification failed; credentials and request details omitted.',
  )
  process.exitCode = 1
} finally {
  for (const c of clients) await c.auth.signOut({ scope: 'local' })
}
