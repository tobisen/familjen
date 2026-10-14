// Real Auth/PostgREST isolation test. Only synthetic request IDs are returned for cleanup.
import { createClient } from '@supabase/supabase-js'
let raw = ''
for await (const chunk of process.stdin) raw += chunk
const input = JSON.parse(raw)
raw = ''
const clients = [],
  requests = []
let success = false,
  stage = 'auth'
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
      type: 'magiclink',
      token_hash: input.tokens[who],
    })
    assert(!result.error)
    clients.push(client)
  }
  const [member, other, outsider] = clients
  stage = 'family isolation'
  for (const [index, client] of [member, other].entries()) {
    const request = crypto.randomUUID()
    requests.push(request)
    const result = await client.rpc('chat_send', {
      message_body: 'Temporary chat RLS verification',
      request_id: request,
    })
    assert(!result.error)
    const own = await client.rpc('chat_page')
    assert(!own.error)
    const message = own.data.find((m) => m.client_request_id === request)
    assert(message)
    const foreign = clients[1 - index]
    const page = await foreign.rpc('chat_page')
    assert(!page.error && !page.data.some((m) => m.id === message.id))
    for (const reader of [foreign, outsider]) {
      assert(
        !!(
          await reader.rpc('chat_change', {
            message_id: message.id,
            message_body: 'Forbidden',
            expected_version: 1,
          })
        ).error,
      )
      assert(
        !!(
          await reader.rpc('chat_change', {
            message_id: message.id,
            message_body: '',
            expected_version: 1,
            remove_message: true,
          })
        ).error,
      )
      const rows = await reader
        .from('chat_messages')
        .select('*')
        .eq('id', message.id)
      assert(!rows.error && rows.data.length === 0)
    }
    assert(
      !!(
        await client
          .from('chat_messages')
          .update({ sender_id: crypto.randomUUID() })
          .eq('id', message.id)
      ).error,
    )
  }
  stage = 'unregistered and private per-profile state'
  for (const fn of ['chat_page', 'chat_summary'])
    assert(!!(await outsider.rpc(fn)).error)
  assert(
    !!(
      await outsider.rpc('chat_send', {
        message_body: 'Forbidden',
        request_id: crypto.randomUUID(),
      })
    ).error,
  )
  assert(!!(await outsider.rpc('chat_mark_read', { through_seq: 0 })).error)
  assert(!!(await outsider.rpc('chat_preferences', { enabled: false })).error)
  assert(!(await other.rpc('chat_preferences', { enabled: false })).error)
  const ownPrefs = await other.from('notification_preferences').select('*')
  assert(!ownPrefs.error && ownPrefs.data.length === 1)
  const otherProfile = ownPrefs.data[0].profile_id
  const memberPrefs = await member
    .from('notification_preferences')
    .select('*')
    .eq('profile_id', otherProfile)
  assert(!memberPrefs.error && memberPrefs.data.length === 0)
  success = true
} catch {
  process.exitCode = 1
} finally {
  for (const client of clients) await client.removeAllChannels()
  console.log(JSON.stringify({ success, stage, requests }))
}
