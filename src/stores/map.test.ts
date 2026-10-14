import { ref } from 'vue'
import { geoPermission } from '../services/geolocation'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
vi.mock('../services/geolocation', () => ({
  geoPermission: ref('granted'),
  startGeolocation: vi.fn(),
  stopGeolocation: vi.fn(),
}))
vi.mock('../data/mapRepository', () => ({ createMapRepository: () => null }))
import {
  startMap,
  stopMap,
  reloadMap,
  publishPosition,
  mapData,
  mapStatus,
  sendHelp,
  helpId,
  helpDeliveries,
} from './map'
import type { MapRepository } from '../data/mapRepository'
let repository: MapRepository
beforeEach(() => {
  geoPermission.value = 'granted'
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  repository = {
    load: vi.fn().mockResolvedValue({ people: [], positions: [] }),
    report: vi.fn().mockResolvedValue({ accepted: true }),
    help: vi.fn().mockResolvedValue('help'),
    helpPosition: vi.fn().mockResolvedValue({
      position: null,
      name: 'Neo',
      created_at: new Date().toISOString(),
    }),
    helpStatus: vi.fn().mockResolvedValue([]),
    subscribe: vi.fn().mockReturnValue(vi.fn()),
  }
})
afterEach(() => {
  stopMap()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
it('protects against late snapshots after a session ends', async () => {
  let finish!: (v: unknown) => void
  repository.load = vi
    .fn()
    .mockImplementation(() => new Promise((r) => (finish = r)))
  startMap(repository)
  stopMap()
  finish({ people: [{ id: 'private' }], positions: [] })
  await Promise.resolve()
  expect(mapData.value.people).toEqual([])
  expect(mapStatus.value).toBe('unconfigured')
})
it('writes fresh samples once, without persisting coordinates in browser storage', async () => {
  startMap(repository)
  await reloadMap()
  const s = {
    latitude: 59.86,
    longitude: 17.64,
    accuracy: 12,
    timestamp: Date.now(),
  }
  const before = JSON.stringify(localStorage)
  await publishPosition(s)
  await publishPosition(s)
  expect(repository.report).toHaveBeenCalledOnce()
  expect(JSON.stringify(localStorage)).toBe(before)
})
it('acknowledges a sent help message even when reading push status fails', async () => {
  startMap(repository)
  await reloadMap()
  repository.helpStatus = vi.fn().mockRejectedValue(new Error('network'))
  expect(await sendHelp(null, 'stable-request')).toBe('help')
  expect(helpId.value).toBe('help')
  expect(helpDeliveries.value).toEqual([])
})

it('queues the latest movement during a slow write and sends it after the throttle window', async () => {
  vi.useFakeTimers()
  startMap(repository)
  await reloadMap()
  let finish!: (r: { accepted: boolean }) => void
  repository.report = vi
    .fn()
    .mockImplementationOnce(() => new Promise((r) => (finish = r)))
    .mockResolvedValue({ accepted: true })
  const first = {
    latitude: 59.86,
    longitude: 17.64,
    accuracy: 10,
    timestamp: Date.now(),
  }
  const saving = publishPosition(first)
  await publishPosition({
    ...first,
    latitude: 59.87,
    timestamp: first.timestamp + 1000,
  })
  expect(repository.report).toHaveBeenCalledTimes(1)
  finish({ accepted: true })
  await saving
  await vi.advanceTimersByTimeAsync(10001)
  expect(repository.report).toHaveBeenCalledTimes(2)
  expect(repository.report).toHaveBeenLastCalledWith(
    expect.objectContaining({ latitude: 59.87 }),
  )
})
it('never drains queued coordinates while hidden or after logout', async () => {
  vi.useFakeTimers()
  startMap(repository)
  await reloadMap()
  const first = {
    latitude: 59.86,
    longitude: 17.64,
    accuracy: 10,
    timestamp: Date.now(),
  }
  await publishPosition(first)
  await publishPosition({
    ...first,
    latitude: 59.87,
    timestamp: first.timestamp + 1000,
  })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(20000)
  expect(repository.report).toHaveBeenCalledTimes(1)
  stopMap()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(20000)
  expect(repository.report).toHaveBeenCalledTimes(1)
})

it('discards queued reports immediately when OS location permission is revoked', async () => {
  vi.useFakeTimers()
  startMap(repository)
  await reloadMap()
  const first = {
    latitude: 59.86,
    longitude: 17.64,
    accuracy: 10,
    timestamp: Date.now(),
  }
  await publishPosition(first)
  await publishPosition({
    ...first,
    latitude: 59.87,
    timestamp: first.timestamp + 1000,
  })
  geoPermission.value = 'denied'
  await vi.advanceTimersByTimeAsync(20000)
  expect(repository.report).toHaveBeenCalledTimes(1)
})
