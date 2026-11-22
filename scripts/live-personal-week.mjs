// Operator-only hosted verification. Credentials arrive through stdin, never logs.
import { createClient } from '@supabase/supabase-js'
let raw = ''
for await (const part of process.stdin) raw += part
const input = JSON.parse(raw)
raw = ''
const clients = []
let createdId = null,
  stage = 'authentication',
  passed = false
const setStage = (value) => {
  stage = value
  console.error('Live verification: ' + value)
}
const assert = (value) => {
  if (!value) throw new Error('Access assertion failed')
}
try {
  for (const name of ['tobias', 'neo', 'sally']) {
    setStage('authentication ' + name)
    const client = createClient(input.url, input.key, {
      global: {
        fetch: (url, options) =>
          fetch(url, { ...options, signal: AbortSignal.timeout(15000) }),
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
    const { error } = await client.auth.verifyOtp({
      token_hash: input.tokens[name],
      type: 'magiclink',
    })
    if (error)
      stage +=
        ' ' + error.name + ':' + (error.code ?? '') + ':' + (error.status ?? '')
    assert(!error)
    clients.push(client)
  }
  const [owner, ...others] = clients
  const who = await owner.rpc('personal_week_owner')
  assert(!who.error && typeof who.data === 'string')
  setStage('find unused future week')
  let week
  for (let candidate = 1; candidate <= 52; candidate++) {
    const result = await owner.rpc('personal_week_snapshot', {
      target_year: 2099,
      target_week: candidate,
    })
    assert(!result.error)
    if (!result.data) {
      week = candidate
      break
    }
  }
  assert(week)
  const jan4 = new Date('2099-01-04T12:00:00Z')
  jan4.setUTCDate(
    jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (week - 1) * 7,
  )
  const payload = {
    year: 2099,
    week_number: week,
    week_type: 'specialvecka',
    focus: ['Automated verification'],
    weekly_summary: {},
    days: Array.from({ length: 7 }, (_, i) => {
      const day = new Date(jan4)
      day.setUTCDate(day.getUTCDate() + i)
      return {
        date: day.toISOString().slice(0, 10),
        priority: 'normal',
        items: i
          ? []
          : [{ category: 'other', content: 'Verification only', done: false }],
      }
    }),
    tasks: [{ category: 'other', task: 'Verification only', done: false }],
  }
  const request = crypto.randomUUID()
  const save = (data, version, id = crypto.randomUUID(), client = owner) =>
    client.rpc('personal_week_save', {
      payload: data,
      expected_version: version,
      request_id: id,
    })
  setStage('create and retry')
  let result = await save(payload, null, request)
  assert(!result.error)
  createdId = result.data.id
  assert(result.data.owner_id === who.data && result.data.version === 1)
  assert(!(await save(payload, null, request)).error)
  assert((await save(payload, null)).error)
  let saved = result.data
  setStage('edit and checkbox')
  saved.days[0].items[0].content = 'Changed verification'
  saved.tasks[0].done = true
  result = await save(saved, saved.version)
  assert(
    !result.error &&
      result.data.tasks[0].done &&
      result.data.days[0].items[0].content === 'Changed verification',
  )
  saved = result.data
  setStage('rollback and version conflict')
  assert(
    (
      await save(
        {
          ...payload,
          tasks: [{ category: 'invalid', task: 'Invalid', done: false }],
        },
        saved.version,
      )
    ).error,
  )
  const after = await owner.rpc('personal_week_snapshot', {
    target_year: 2099,
    target_week: week,
  })
  assert(
    !after.error &&
      after.data.version === saved.version &&
      after.data.tasks[0].done,
  )
  assert((await save(payload, 1)).error)
  setStage('forged owner and direct writes')
  assert(
    (await save({ ...payload, owner_id: crypto.randomUUID() }, saved.version))
      .error,
  )
  for (const client of clients)
    for (const table of [
      'personal_weeks',
      'personal_week_days',
      'personal_day_items',
      'personal_week_tasks',
    ]) {
      assert((await client.from(table).insert({ owner_id: who.data })).error)
      assert(
        (
          await client
            .from(table)
            .update({ owner_id: who.data })
            .eq('owner_id', who.data)
        ).error,
      )
      assert((await client.from(table).delete().eq('owner_id', who.data)).error)
    }
  setStage('Neo and Sally private API denial')
  for (const client of others) {
    const capability = await client.rpc('personal_week_owner')
    assert(!capability.error && capability.data === null)
    assert(
      (
        await client.rpc('personal_week_snapshot', {
          target_year: 2099,
          target_week: week,
        })
      ).error,
    )
    assert(
      (await save(payload, saved.version, crypto.randomUUID(), client)).error,
    )
    for (const table of [
      'personal_weeks',
      'personal_week_days',
      'personal_day_items',
      'personal_week_tasks',
    ]) {
      const read = await client.from(table).select('*').eq('owner_id', who.data)
      assert(!read.error && read.data.length === 0)
    }
  }
  setStage('confirmed replacement')
  result = await save(payload, saved.version)
  assert(
    !result.error &&
      result.data.id === createdId &&
      !result.data.tasks[0].done &&
      result.data.tasks.length === 1,
  )
  passed = true
} catch {
  process.exitCode = 1
} finally {
  for (const client of clients) {
    await client.auth.signOut({ scope: 'local' }).catch(() => {})
    await client.removeAllChannels()
  }
  console.log(JSON.stringify({ passed, stage, createdId }))
}
