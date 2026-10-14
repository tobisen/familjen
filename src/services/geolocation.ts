import { ref } from 'vue'
import type { Sample } from '../domain/location'
export const geoPermission = ref<PermissionState | 'unsupported'>('prompt')
export const geoError = ref('')
export const geoWatching = ref(false)
let watchId: number | null = null,
  timer: ReturnType<typeof setInterval> | null = null,
  permission: PermissionStatus | null = null
let callback: ((sample: Sample) => void) | null = null,
  generation = 0,
  reading = false
const sample = (p: GeolocationPosition): Sample => ({
  latitude: p.coords.latitude,
  longitude: p.coords.longitude,
  accuracy: p.coords.accuracy,
  timestamp: p.timestamp,
})
function failure(e: GeolocationPositionError) {
  if (e.code === 1) {
    geoPermission.value = 'denied'
    pause()
  }
  geoError.value =
    e.code === 1
      ? 'Platsbehörighet är nekad. Tillåt plats i telefonens eller webbläsarens inställningar.'
      : e.code === 3
        ? 'GPS tar för lång tid. Försök igen med bättre signal.'
        : 'GPS-positionen kunde inte bestämmas. Kontrollera platstjänster och signal.'
}
function pause() {
  if (watchId !== null) navigator.geolocation?.clearWatch(watchId)
  watchId = null
  geoWatching.value = false
  if (timer) clearInterval(timer)
  timer = null
}
function watch() {
  if (
    !callback ||
    geoPermission.value !== 'granted' ||
    document.visibilityState !== 'visible' ||
    watchId !== null
  )
    return
  const token = generation
  geoWatching.value = true
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      if (token === generation && document.visibilityState === 'visible') {
        geoError.value = ''
        callback?.(sample(p))
      }
    },
    (e) => {
      if (token === generation) failure(e)
    },
    { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 },
  )
  timer = setInterval(() => {
    if (!reading && navigator.onLine)
      void freshPosition(false)
        .then((p) => {
          if (token === generation) callback?.(p)
        })
        .catch(() => {})
  }, 60000)
}
async function resume() {
  if (!callback || document.visibilityState !== 'visible') {
    pause()
    return
  }
  const token = generation
  try {
    const p = await navigator.permissions?.query({ name: 'geolocation' })
    if (token !== generation) return
    if (p) {
      permission = p
      geoPermission.value = p.state
      p.onchange = () => {
        if (token !== generation) return
        geoPermission.value = p.state
        if (p.state === 'granted') watch()
        else pause()
      }
    }
  } catch {
    /* Permission API is optional; explicit user action remains available. */
  }
  if (token === generation) watch()
}
function visible() {
  if (document.visibilityState === 'visible') void resume()
  else pause()
}
function reconnected() {
  const token = generation
  if (document.visibilityState === 'visible') {
    void resume()
    if (geoPermission.value === 'granted' && !reading)
      void freshPosition(false)
        .then((p) => {
          if (token === generation) callback?.(p)
        })
        .catch(() => {})
  }
}
export function startGeolocation(onSample: (s: Sample) => void) {
  stopGeolocation()
  callback = onSample
  if (!navigator.geolocation) {
    geoPermission.value = 'unsupported'
    return
  }
  window.addEventListener('online', reconnected)
  document.addEventListener('visibilitychange', visible)
  void resume()
}
export function stopGeolocation() {
  generation++
  callback = null
  pause()
  reading = false
  if (permission) permission.onchange = null
  permission = null
  geoError.value = ''
  geoPermission.value = 'prompt'
  window.removeEventListener('online', reconnected)
  document.removeEventListener('visibilitychange', visible)
}
export function freshPosition(highAccuracy = true): Promise<Sample> {
  const token = generation
  reading = true
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reading = false
      reject(Error('GPS stöds inte på den här enheten.'))
      return
    }
    const timeout = setTimeout(() => {
      reading = false
      reject(Error('GPS svarade inte. Försök igen.'))
    }, 16000)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timeout)
        reading = false
        if (token !== generation || !callback) {
          reject(Error('Sessionen har ändrats.'))
          return
        }
        geoPermission.value = 'granted'
        geoError.value = ''
        watch()
        resolve(sample(p))
      },
      (e) => {
        clearTimeout(timeout)
        reading = false
        if (token === generation) failure(e)
        reject(Error(geoError.value || 'GPS kunde inte hämtas.'))
      },
      {
        enableHighAccuracy: highAccuracy,
        maximumAge: highAccuracy ? 0 : 30000,
        timeout: 12000,
      },
    )
  })
}
export async function requestLocation() {
  const token = generation
  const s = await freshPosition()
  if (token !== generation || !callback) throw Error('Sessionen har ändrats.')
  callback(s)
  return s
}
