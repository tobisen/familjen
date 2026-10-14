import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import type { ChatRepository } from '../data/chatRepository'
import type { ChatMessage, ChatSummary } from '../domain/chat'
vi.mock('../data/chatRepository', () => ({ createChatRepository: () => null }))
import {
  startChat,
  stopChat,
  refreshChat,
  openChat,
  messages,
  pendingMessages,
  sendMessage,
  chatSummary,
} from './chat'
const message = {
  id: 'm',
  seq: 1,
  sender_id: 'p',
  body: 'Hej',
  version: 1,
  created_at: '2026-10-14T10:00:00Z',
  edited_at: null,
  deleted_at: null,
  client_request_id: 'r',
} as ChatMessage
const summary: ChatSummary = {
  last_message: message,
  unread: 1,
  last_read_seq: 0,
  chat_enabled: true,
  people: [],
}
let repository: ChatRepository
beforeEach(() => {
  stopChat()
  repository = {
    page: vi.fn().mockResolvedValue([message]),
    summary: vi.fn().mockResolvedValue({ ...summary }),
    send: vi.fn().mockResolvedValue(message),
    change: vi.fn().mockResolvedValue(message),
    read: vi.fn().mockResolvedValue(undefined),
    preferences: vi.fn(),
    subscribe: vi.fn().mockReturnValue(vi.fn()),
  }
})
afterEach(() => stopChat())
it('does not load history until chat is opened', async () => {
  startChat(repository)
  await refreshChat()
  expect(repository.page).not.toHaveBeenCalled()
  await openChat()
  expect(messages.value).toHaveLength(1)
})
it('clears messages and failed sends on logout; late reads never restore private data', async () => {
  let resolve!: (s: ChatSummary) => void
  repository.summary = vi.fn().mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  startChat(repository)
  stopChat()
  resolve(summary)
  await Promise.resolve()
  expect(messages.value).toEqual([])
  expect(chatSummary.value.last_message).toBeNull()
  expect(pendingMessages.value).toEqual([])
})
it('retains failed request for safe retry and merges acknowledgement by ID', async () => {
  startChat(repository)
  await refreshChat()
  repository.send = vi
    .fn()
    .mockRejectedValueOnce(new Error('Nätfel'))
    .mockResolvedValue(message)
  await sendMessage('Hej', 'r')
  expect(pendingMessages.value[0]?.status).toBe('failed')
  await sendMessage('Hej', 'r')
  expect(pendingMessages.value).toEqual([])
  expect(messages.value).toHaveLength(1)
  expect(repository.send).toHaveBeenNthCalledWith(2, 'Hej', 'r')
})
it('blocks double send of the same in-flight request', async () => {
  startChat(repository)
  await refreshChat()
  let resolve!: (m: ChatMessage) => void
  repository.send = vi.fn().mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  const first = sendMessage('Hej', 'r')
  await sendMessage('Hej', 'r')
  expect(repository.send).toHaveBeenCalledTimes(1)
  resolve(message)
  await first
})

it('removes pending bubble when Realtime confirms before a lost RPC acknowledgement', async () => {
  repository.page = vi.fn().mockResolvedValue([])
  repository.summary = vi
    .fn()
    .mockResolvedValue({ ...summary, last_message: null, unread: 0 })
  let incoming!: (message: ChatMessage | null) => void
  repository.subscribe = vi.fn().mockImplementation((callback) => {
    incoming = callback
    return vi.fn()
  })
  startChat(repository)
  await openChat()
  let reject!: (error: Error) => void
  repository.send = vi.fn().mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r
      }),
  )
  const pending = sendMessage('Hej', 'r')
  expect(pendingMessages.value).toHaveLength(1)
  incoming(message)
  expect(pendingMessages.value).toEqual([])
  expect(messages.value.filter((m) => m.id === message.id)).toHaveLength(1)
  reject(new Error('Response lost'))
  await pending
  expect(pendingMessages.value).toEqual([])
})

it('ignores a late Realtime event from a previous identity after session switch', async () => {
  let oldIncoming!: (message: ChatMessage | null) => void
  repository.subscribe = vi.fn().mockImplementation((callback) => {
    oldIncoming = callback
    return vi.fn()
  })
  startChat(repository)
  await openChat()
  stopChat()
  const next = {
    ...repository,
    page: vi.fn().mockResolvedValue([]),
    summary: vi
      .fn()
      .mockResolvedValue({ ...summary, last_message: null, unread: 0 }),
    subscribe: vi.fn().mockReturnValue(vi.fn()),
  }
  startChat(next)
  await openChat()
  oldIncoming(message)
  expect(messages.value).toEqual([])
})
