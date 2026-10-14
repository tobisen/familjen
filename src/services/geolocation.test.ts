import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import {
  startGeolocation,
  stopGeolocation,
  requestLocation,
  freshPosition,
  geoPermission,
  geoWatching,
  geoError,
} from './geolocation'
let success: PositionCallback,
  failure: PositionErrorCallback,
  current: PositionCallback
let permission: { state: PermissionState; onchange: (() => void) | null },
  state: DocumentVisibilityState
const watch = vi.fn(),
  clear = vi.fn(),
  get = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  state = 'visible'
  permission = { state: 'granted', onchange: null }
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  watch.mockImplementation((s, e) => {
    success = s
    failure = e
    return 1
  })
  clear.mockReset()
  get.mockImplementation((s) => {
    current = s
  })
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition: watch, clearWatch: clear, getCurrentPosition: get },
  })
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: vi.fn().mockResolvedValue(permission) },
  })
})
afterEach(() => {
  stopGeolocation()
  vi.useRealTimers()
  vi.restoreAllMocks()
  watch.mockClear()
  get.mockClear()
})
const point = () =>
  ({
    coords: { latitude: 59.86, longitude: 17.64, accuracy: 10 },
    timestamp: Date.now(),
  }) as GeolocationPosition
it('uses a single foreground watch, pauses when hidden and resumes on return', async () => {
  const callback = vi.fn()
  startGeolocation(callback)
  await Promise.resolve()
  expect(watch).toHaveBeenCalledTimes(1)
  expect(geoWatching.value).toBe(true)
  success(point())
  expect(callback).toHaveBeenCalledOnce()
  state = 'hidden'
  document.dispatchEvent(new Event('visibilitychange'))
  expect(clear).toHaveBeenCalledWith(1)
  expect(geoWatching.value).toBe(false)
  success(point())
  expect(callback).toHaveBeenCalledOnce()
  state = 'visible'
  document.dispatchEvent(new Event('visibilitychange'))
  await Promise.resolve()
  expect(watch).toHaveBeenCalledTimes(2)
  window.dispatchEvent(new Event('online'))
  await Promise.resolve()
  expect(watch).toHaveBeenCalledTimes(2)
})
it('does not prompt automatically and respects permission denial', async () => {
  permission.state = 'prompt'
  startGeolocation(vi.fn())
  await Promise.resolve()
  expect(watch).not.toHaveBeenCalled()
  expect(get).not.toHaveBeenCalled()
  permission.state = 'granted'
  permission.onchange?.()
  expect(watch).toHaveBeenCalledOnce()
  failure({ code: 1, message: 'denied' } as GeolocationPositionError)
  expect(geoPermission.value).toBe('denied')
  expect(geoWatching.value).toBe(false)
  expect(geoError.value).toContain('nekad')
})
it('discarded callbacks cannot write a previous session position after logout', async () => {
  const callback = vi.fn()
  startGeolocation(callback)
  await Promise.resolve()
  const p = freshPosition()
  const old = current
  stopGeolocation()
  old(point())
  await expect(p).rejects.toThrow(/Sessionen/)
  success(point())
  expect(callback).not.toHaveBeenCalled()
})
it('obtains fresh samples periodically and clears every timer on stop', async () => {
  const callback = vi.fn()
  startGeolocation(callback)
  await Promise.resolve()
  await vi.advanceTimersByTimeAsync(60000)
  expect(get).toHaveBeenCalledOnce()
  current(point())
  await Promise.resolve()
  expect(callback).toHaveBeenCalledOnce()
  stopGeolocation()
  await vi.advanceTimersByTimeAsync(120000)
  expect(get).toHaveBeenCalledOnce()
})
it('explicit permission flow publishes the result and timeout is recoverable', async () => {
  permission.state = 'prompt'
  const callback = vi.fn()
  startGeolocation(callback)
  await Promise.resolve()
  const p = requestLocation()
  current(point())
  await p
  expect(geoPermission.value).toBe('granted')
  expect(callback).toHaveBeenCalledOnce()
  const timeout = freshPosition().catch((e) => e)
  await vi.advanceTimersByTimeAsync(16000)
  expect((await timeout).message).toContain('svarade inte')
})

it('does not hand an already-resolved sample to a new session', async () => {
  const callback = vi.fn()
  startGeolocation(callback)
  await Promise.resolve()
  const pending = requestLocation()
  current(point())
  stopGeolocation()
  await expect(pending).rejects.toThrow(/Sessionen/)
  expect(callback).not.toHaveBeenCalled()
})
