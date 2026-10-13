import { beforeEach, it, expect, vi } from 'vitest'
const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
  on: vi.fn(),
  subscribe: vi.fn(),
}))
vi.mock('../services/supabase', () => ({ supabase: fake }))
import { createCalendarRepository } from './calendarRepository'
beforeEach(() => {
  vi.clearAllMocks()
  fake.on.mockReturnValue(fake)
  fake.channel.mockReturnValue(fake)
  fake.rpc.mockResolvedValue({ data: [], error: null })
})
it('subscribes to private tables only and refreshes after connection and mutation', () => {
  const change = vi.fn()
  const status = vi.fn()
  const dispose = createCalendarRepository()!.subscribe(change, status)
  expect(fake.on.mock.calls.map((call) => call[1].table)).toEqual([
    'private_calendar_events',
    'private_school_lessons',
    'private_calendar_people',
    'private_calendar_settings',
  ])
  const connected = fake.subscribe.mock.calls[0]![0]
  connected('SUBSCRIBED')
  expect(change).toHaveBeenCalledOnce()
  expect(status).toHaveBeenCalledWith('SUBSCRIBED')
  fake.on.mock.calls[0]![2]()
  expect(change).toHaveBeenCalledTimes(2)
  dispose()
  expect(fake.removeChannel).toHaveBeenCalledWith(fake)
})
it('propagates server errors without claiming data was saved', async () => {
  fake.rpc.mockResolvedValue({
    data: null,
    error: { message: 'Version conflict' },
  })
  await expect(createCalendarRepository()!.remove('id', 2)).rejects.toThrow(
    'Version conflict',
  )
  expect(fake.rpc).toHaveBeenCalledWith('calendar_delete', {
    event_id: 'id',
    expected_version: 2,
  })
})
it('uses server snapshot and transactional import RPC', async () => {
  await createCalendarRepository()!.load()
  expect(fake.rpc).toHaveBeenCalledWith('calendar_snapshot', undefined)
  await createCalendarRepository()!.importLessons([])
  expect(fake.rpc).toHaveBeenCalledWith('calendar_import', {
    lessons: [],
  })
})
