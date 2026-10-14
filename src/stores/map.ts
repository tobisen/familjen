import { ref } from 'vue'
import { createMapRepository, type MapRepository } from '../data/mapRepository'
import { startGeolocation, stopGeolocation } from '../services/geolocation'
import {
  shouldReport,
  type Sample,
  type MapSnapshot,
  type HelpDelivery,
} from '../domain/location'
export const mapData = ref<MapSnapshot>({ people: [], positions: [] }),
  mapStatus = ref<'unconfigured' | 'loading' | 'ready' | 'error'>(
    'unconfigured',
  ),
  mapError = ref(''),
  mapSync = ref('Ansluter')
export const lastSample = ref<Sample | null>(null),
  helpId = ref<string | null>(null),
  helpDeliveries = ref<HelpDelivery[]>([])
let repository: MapRepository | null = null,
  unsubscribe: (() => void) | null = null,
  generation = 0,
  busy = false
let lastSent = 0,
  previous: Sample | null = null,
  loading: Promise<void> | null = null,
  dirty = false
export async function reloadMap(): Promise<void> {
  if (!repository) return
  if (loading) {
    dirty = true
    return loading
  }
  const r = repository,
    token = generation
  loading = (async () => {
    do {
      dirty = false
      try {
        const data = await r.load()
        if (token !== generation) return
        mapData.value = data
        mapStatus.value = 'ready'
        mapError.value = ''
      } catch {
        if (token === generation) {
          mapStatus.value = 'error'
          mapError.value =
            'Kartan kunde inte synkas. Kontrollera nätverket och försök igen.'
        }
      }
    } while (dirty && token === generation)
  })()
  const p = loading
  try {
    await p
  } finally {
    if (loading === p) loading = null
  }
}
export async function publishPosition(s: Sample) {
  lastSample.value = s
  if (
    !repository ||
    busy ||
    !navigator.onLine ||
    document.visibilityState !== 'visible' ||
    !shouldReport(s, previous, lastSent)
  )
    return
  const r = repository,
    token = generation
  busy = true
  try {
    const result = await r.report(s)
    if (token !== generation) return
    if (result.accepted) {
      previous = s
      lastSent = Date.now()
      await reloadMap()
    }
    mapError.value = ''
  } catch {
    if (token === generation)
      mapError.value =
        'Positionen kunde inte skickas. Den gamla positionens tid behålls tills en ny uppdatering lyckas.'
  } finally {
    if (token === generation) busy = false
  }
}
export function stopMap() {
  generation++
  unsubscribe?.()
  unsubscribe = null
  repository = null
  stopGeolocation()
  mapData.value = { people: [], positions: [] }
  mapStatus.value = 'unconfigured'
  mapError.value = ''
  mapSync.value = 'Ej ansluten'
  lastSample.value = null
  previous = null
  lastSent = 0
  busy = false
  loading = null
  dirty = false
  helpId.value = null
  helpDeliveries.value = []
}
export function startMap(injected?: MapRepository) {
  if (repository && !injected) {
    void reloadMap()
    return
  }
  stopMap()
  repository = injected ?? createMapRepository()
  if (!repository) return
  const token = generation
  mapStatus.value = 'loading'
  void reloadMap()
  unsubscribe = repository.subscribe(
    () => {
      if (token === generation) void reloadMap()
    },
    (status) => {
      if (token === generation)
        mapSync.value =
          status === 'SUBSCRIBED' ? 'Realtid ansluten' : 'Realtid återansluter'
    },
  )
  startGeolocation((s) => {
    if (token === generation) void publishPosition(s)
  })
}
export async function sendHelp(s: Sample | null, request: string) {
  if (!repository || !navigator.onLine)
    throw Error('Nätanslutning krävs för att skicka hjälpmeddelandet.')
  const token = generation
  const id = await repository.help(s, request)
  if (token !== generation) throw Error('Sessionen har ändrats.')
  helpId.value = id
  await refreshHelpStatus().catch(() => {
    helpDeliveries.value = []
  })
  return id
}
export async function refreshHelpStatus() {
  if (!repository || !helpId.value) return
  const token = generation
  try {
    const rows = await repository.helpStatus(helpId.value)
    if (token === generation) helpDeliveries.value = rows
  } catch (e) {
    if (token === generation) helpDeliveries.value = []
    throw e
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void reloadMap()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void reloadMap()
  })
}
