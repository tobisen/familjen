// Hosted family-isolation verification. Credentials arrive in memory over stdin.
import { createClient } from '@supabase/supabase-js'
let raw = ''
for await (const part of process.stdin) raw += part
const input = JSON.parse(raw)
raw = ''
const clients = [],
  created = []
let stage = 'auth'
const assert = (ok) => {
  if (!ok) throw new Error('Access assertion failed')
}
try {
  for (const who of ['member', 'other', 'outsider']) {
    const client = createClient(input.url, input.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
    const result = await client.auth.verifyOtp({
      token_hash: input.tokens[who],
      type: 'magiclink',
    })
    assert(!result.error)
    clients.push(client)
  }
  const [member, other, outsider] = clients
  stage = 'server-owned identity'
  for (const kind of ['task', 'shopping']) {
    const payload =
      kind === 'task'
        ? {
            title: 'RLS list verification ' + crypto.randomUUID(),
            description: '',
            deadline: null,
            priority: 'normal',
            assigned_ids: ['neo'],
            recurrence: null,
            reminder_days: null,
          }
        : {
            title: 'RLS list verification ' + crypto.randomUUID(),
            amount: 1,
            unit: '',
          }
    payload.family_id = input.otherFamily
    payload.created_by = crypto.randomUUID()
    const result = await member.rpc('lists_save', {
      kind,
      payload,
      request_id: crypto.randomUUID(),
    })
    assert(!result.error)
    const id = result.data
    created.push({ kind, id })
    const snapshot = await member.rpc('lists_snapshot')
    assert(!snapshot.error)
    const row = (
      kind === 'task' ? snapshot.data.tasks : snapshot.data.shopping
    ).find((r) => r.id === id)
    assert(
      row.family_id !== input.otherFamily &&
        row.created_by === input.memberProfile,
    )
    stage = 'other family and unregistered RPC denial'
    const otherSnapshot = await other.rpc('lists_snapshot')
    assert(!otherSnapshot.error)
    assert(
      !(
        kind === 'task' ? otherSnapshot.data.tasks : otherSnapshot.data.shopping
      ).some((r) => r.id === id),
    )
    for (const client of [other, outsider]) {
      assert(
        !!(
          await client.rpc('lists_save', {
            kind,
            payload,
            item_id: id,
            expected_version: 1,
          })
        ).error,
      )
      assert(
        !!(
          await client.rpc('lists_set_done', {
            kind,
            item_id: id,
            done: true,
            expected_version: 1,
          })
        ).error,
      )
      assert(
        !!(
          await client.rpc('lists_delete', {
            kind,
            item_id: id,
            expected_version: 1,
          })
        ).error,
      )
    }
    stage = 'direct table restrictions'
    const table = kind === 'task' ? 'tasks' : 'shopping_items'
    for (const client of [other, outsider]) {
      const read = await client.from(table).select('*').eq('id', id)
      assert(!read.error && read.data.length === 0)
    }
    assert(
      !!(await member.from(table).update({ title: 'Forbidden' }).eq('id', id))
        .error,
    )
  }
  assert(!!(await outsider.rpc('lists_snapshot')).error)
  const assignments = await other.from('task_assignees').select('*')
  assert(!assignments.error && assignments.data.length === 0)
  console.log(
    'LIVE PASS: real registered other family and unregistered Auth user cannot read or mutate list rows; direct writes denied; forged family/creator ignored; audit identity server-owned.',
  )
} catch {
  console.error('LIVE RLS FAIL at ' + stage)
  process.exitCode = 1
} finally {
  if (clients[0]) {
    const { data, error } = await clients[0].rpc('lists_snapshot')
    if (!error)
      for (const { kind, id } of created) {
        const row = (kind === 'task' ? data.tasks : data.shopping).find(
          (r) => r.id === id,
        )
        if (row) {
          const result = await clients[0].rpc('lists_delete', {
            kind,
            item_id: id,
            expected_version: row.version,
          })
          if (result.error) process.exitCode = 1
        }
      }
  }
  for (const client of clients) await client.removeAllChannels()
}
