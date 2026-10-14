// @vitest-environment node
import { beforeEach, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { IDBFactory } from 'fake-indexeddb'
let handlers: Record<string, (event: Record<string, unknown>) => void>,
  notifications: unknown[],
  opened: string[],
  worker: Record<string, unknown>
const scope = 'https://tobisen.github.io/familjen/'
async function fire(type: string, event: Record<string, unknown>) {
  let pending = Promise.resolve()
  handlers[type]!({
    ...event,
    waitUntil: (p: Promise<void>) => {
      pending = p
    },
  })
  await pending
}
beforeEach(() => {
  handlers = {}
  notifications = []
  opened = []
  worker = {
    registration: {
      scope,
      showNotification: async (title: string, options: unknown) =>
        notifications.push({ title, options }),
    },
    clients: {
      matchAll: async () => [],
      openWindow: async (url: string) => opened.push(url),
    },
    addEventListener: (name: string, callback: (typeof handlers)[string]) => {
      handlers[name] = callback
    },
  }
  runInNewContext(readFileSync('public/push-sw.js', 'utf8'), {
    self: worker,
    indexedDB: new IDBFactory(),
    URL,
    Date,
    console,
    setTimeout,
  })
})
it('only displays notifications for the registered owner and deduplicates across pushes', async () => {
  await fire('message', {
    source: { url: scope },
    data: { type: 'FAMILJEN_PUSH_OWNER', profileId: 'sally' },
    ports: [],
  })
  const data = {
    id: 'job-1',
    recipient: 'sally',
    title: 'Fixture',
    body: 'Fixture body',
    path: '/chatt?message=fixture',
  }
  await fire('push', { data: { json: () => data } })
  await fire('push', { data: { json: () => data } })
  expect(notifications).toHaveLength(1)
  await fire('push', {
    data: { json: () => ({ ...data, id: 'job-2', recipient: 'neo' }) },
  })
  expect(notifications).toHaveLength(1)
  await fire('message', {
    source: { url: scope },
    data: { type: 'FAMILJEN_PUSH_OWNER', profileId: null },
    ports: [],
  })
  await fire('push', { data: { json: () => ({ ...data, id: 'job-3' }) } })
  expect(notifications).toHaveLength(1)
})
it('isolates owner messages from other apps on the same GitHub origin', async () => {
  await fire('message', {
    source: { url: 'https://tobisen.github.io/dejter/' },
    data: { type: 'FAMILJEN_PUSH_OWNER', profileId: 'neo' },
    ports: [],
  })
  await fire('push', {
    data: { json: () => ({ id: 'job', recipient: 'neo' }) },
  })
  expect(notifications).toHaveLength(0)
})
it('opens a cold-start deep link only inside the PWA scope', async () => {
  await fire('notificationclick', {
    notification: {
      close: () => {},
      data: { url: scope + '#/kalender?activity=fixture' },
    },
  })
  expect(opened).toEqual([scope + '#/kalender?activity=fixture'])
  await fire('notificationclick', {
    notification: { close: () => {}, data: { url: 'https://evil.invalid/' } },
  })
  expect(opened).toHaveLength(1)
})
it('ignores malformed push data and sanitizes unexpected notification paths', async () => {
  await fire('push', {
    data: {
      json: () => {
        throw Error('Malformed')
      },
    },
  })
  await fire('message', {
    source: { url: scope },
    data: { type: 'FAMILJEN_PUSH_OWNER', profileId: 'p' },
    ports: [],
  })
  await fire('push', {
    data: {
      json: () => ({ id: 'job', recipient: 'p', path: 'javascript:alert(1)' }),
    },
  })
  expect(notifications).toMatchObject([
    { options: { data: { url: scope + '#/chatt' } } },
  ])
})
