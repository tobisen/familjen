import { beforeEach, afterEach, it, expect, vi } from 'vitest'
vi.mock('../services/geolocation', () => ({
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
