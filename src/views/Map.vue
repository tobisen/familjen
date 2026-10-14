<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { createMapRepository } from '../data/mapRepository'
import { useRoute } from 'vue-router'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Crosshair, UsersRound, Maximize2, HandHeart, X } from 'lucide-vue-next'
import { identity } from '../stores/auth'
import { profiles } from '../domain/profiles'
import {
  mapData,
  mapStatus,
  mapError,
  mapSync,
  reloadMap,
  publishPosition,
  sendHelp,
  helpId,
  helpDeliveries,
  refreshHelpStatus,
} from '../stores/map'
import {
  geoPermission,
  geoWatching,
  geoError,
  requestLocation,
  freshPosition,
} from '../services/geolocation'
import {
  ageStatus,
  ageLabel,
  positionTime,
  helpDeliveryLabel,
  type Sample,
} from '../domain/location'
const markers = new Map<string, L.Marker>()
let linkedMarker: L.CircleMarker | null = null
const route = useRoute(),
  element = ref<HTMLDivElement | null>(null),
  container = ref<HTMLElement | null>(null),
  now = ref(Date.now()),
  tileError = ref(false),
  error = ref(''),
  busy = ref(false),
  preparing = ref(false),
  showHelp = ref(false),
  candidate = ref<Sample | null>(null),
  helpDialog = ref<HTMLDialogElement | null>(null)
let alive = true
let map: L.Map | null = null,
  layer: L.LayerGroup | null = null,
  firstFit = false,
  request = crypto.randomUUID(),
  tick: ReturnType<typeof setInterval> | null = null
const people = computed(() =>
  mapData.value.people.length
    ? mapData.value.people
    : profiles.map((p) => ({ id: p.id, key: p.id, name: p.name })),
)
const own = computed(() =>
  mapData.value.positions.find(
    (p) => p.profile_id === identity.value?.profile_id,
  ),
)
const rows = computed(() =>
  people.value.map((p) => ({
    person: p,
    position: mapData.value.positions.find((s) => s.profile_id === p.id),
  })),
)
const linked = ref<Sample | null>(null),
  linkMessage = ref('')
let linkRequest = 0
watch(
  () => route.query.help,
  async (id) => {
    const token = ++linkRequest
    linked.value = null
    linkMessage.value = ''
    if (typeof id !== 'string') return
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      linkMessage.value = 'Kartlänken är ogiltig.'
      return
    }
    try {
      const record = await createMapRepository()?.helpPosition(id)
      if (token !== linkRequest || !alive) return
      const p = record?.position
      if (
        p &&
        Number.isFinite(p.latitude) &&
        Math.abs(p.latitude) <= 90 &&
        Number.isFinite(p.longitude) &&
        Math.abs(p.longitude) <= 180 &&
        Number.isFinite(p.timestamp)
      ) {
        linked.value = p
        firstFit = false
        draw()
      } else linkMessage.value = 'Hjälpmeddelandet saknar GPS-position.'
    } catch {
      if (token === linkRequest && alive)
        linkMessage.value =
          'Hjälpmeddelandet kunde inte hämtas eller har raderats.'
    }
  },
  { immediate: true },
)
function color(key: string) {
  return profiles.find((p) => p.id === key)?.color ?? 'blue'
}
function fitFamily() {
  if (!map) return
  const points = mapData.value.positions.map((p) =>
    L.latLng(p.latitude, p.longitude),
  )
  if (linked.value)
    points.push(L.latLng(linked.value.latitude, linked.value.longitude))
  if (points.length)
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 })
}
function center(id: string) {
  const p = mapData.value.positions.find((p) => p.profile_id === id)
  if (p) {
    map?.setView([p.latitude, p.longitude], 15)
    markers.get(id)?.openPopup()
  }
}
function draw() {
  if (!map || !layer) return
  const active = new Set<string>()
  for (const row of rows.value) {
    const p = row.position
    if (!p) continue
    const status = ageStatus(Date.parse(p.reported_at), now.value)
    const icon = L.divIcon({
      className: 'family-marker-wrap',
      html: `<span class="family-marker ${color(row.person.key)} ${status.level}">${row.person.key[0]!.toUpperCase()}</span>`,
      iconSize: [42, 42],
      iconAnchor: [21, 21],
    })
    const popup = document.createElement('div')
    const title = document.createElement('strong')
    title.textContent = row.person.name
    popup.append(title)
    for (const text of [
      status.label,
      `GPS: ${positionTime(p.reported_at)}`,
      `Mottagen: ${positionTime(p.received_at)}`,
      `Noggrannhet ±${Math.round(p.accuracy)} m`,
    ]) {
      const line = document.createElement('p')
      line.textContent = text
      popup.append(line)
    }
    active.add(p.profile_id)
    let marker = markers.get(p.profile_id)
    if (!marker) {
      marker = L.marker([p.latitude, p.longitude], {
        icon,
        title: row.person.name,
        alt: row.person.name,
      })
        .bindPopup(popup, { autoPan: false })
        .addTo(layer)
      markers.set(p.profile_id, marker)
    } else {
      if (!marker.getLatLng().equals([p.latitude, p.longitude]))
        marker.setLatLng([p.latitude, p.longitude])
      if ((marker.getIcon() as L.DivIcon).options.html !== icon.options.html)
        marker.setIcon(icon)
      const content = marker.getPopup()?.getContent()
      if (
        !(content instanceof HTMLElement) ||
        content.textContent !== popup.textContent
      )
        marker.setPopupContent(popup)
    }
  }
  for (const [id, marker] of markers)
    if (!active.has(id)) {
      layer.removeLayer(marker)
      markers.delete(id)
    }
  if (linked.value) {
    const point = linked.value
    const popup = document.createElement('div')
    popup.textContent = `Hjälpposition · ${positionTime(point.timestamp)} · ${ageStatus(point.timestamp, now.value).label}`
    if (!linkedMarker)
      linkedMarker = L.circleMarker([point.latitude, point.longitude], {
        radius: 15,
        color: '#d14055',
        weight: 3,
        fillOpacity: 0.25,
      })
        .bindPopup(popup, { autoPan: false })
        .addTo(layer)
    else {
      if (!linkedMarker.getLatLng().equals([point.latitude, point.longitude]))
        linkedMarker.setLatLng([point.latitude, point.longitude])
      const old = linkedMarker.getPopup()?.getContent()
      if (
        !(old instanceof HTMLElement) ||
        old.textContent !== popup.textContent
      )
        linkedMarker.setPopupContent(popup)
    }
  } else if (linkedMarker) {
    layer.removeLayer(linkedMarker)
    linkedMarker = null
  }
  if (!firstFit && (mapData.value.positions.length || linked.value)) {
    fitFamily()
    firstFit = true
  }
}
async function locate() {
  busy.value = true
  error.value = ''
  try {
    const p = await requestLocation()
    if (!alive) return
    await publishPosition(p)
    map?.setView([p.latitude, p.longitude], 15)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'GPS kunde inte hämtas.'
  } finally {
    busy.value = false
  }
}
async function expand() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else if (
      container.value?.requestFullscreen &&
      !container.value.classList.contains('map-expanded')
    )
      await container.value.requestFullscreen()
    else container.value?.classList.toggle('map-expanded')
  } catch {
    container.value?.classList.toggle('map-expanded')
  }
  await nextTick()
  map?.invalidateSize()
}
async function prepareHelp() {
  if (preparing.value || busy.value) return
  preparing.value = true
  error.value = ''
  candidate.value = null
  request = crypto.randomUUID()
  try {
    const fresh = await freshPosition()
    if (!alive) return
    candidate.value = fresh
    await publishPosition(fresh)
  } catch {
    const p = own.value
    if (p)
      candidate.value = {
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy: p.accuracy,
        timestamp: Date.parse(p.reported_at),
      }
  } finally {
    preparing.value = false
    if (alive) {
      showHelp.value = true
      await nextTick()
      if (alive) helpDialog.value?.showModal()
    }
  }
}
async function confirmHelp() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await sendHelp(candidate.value, request)
    showHelp.value = false
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : 'Hjälpmeddelandet kunde inte skickas.'
  } finally {
    busy.value = false
  }
}
function refreshClock() {
  if (document.visibilityState !== 'visible') return
  now.value = Date.now()
  draw()
}
watch([mapData, linked], draw, { deep: true })
onMounted(() => {
  document.addEventListener('visibilitychange', refreshClock)
  if (!element.value) return
  map = L.map(element.value, { zoomControl: false }).setView([59.86, 17.64], 11)
  L.control.zoom({ position: 'bottomleft' }).addTo(map)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
    updateWhenIdle: true,
    keepBuffer: 1,
    referrerPolicy: 'strict-origin-when-cross-origin',
  })
    .on('tileerror', () => {
      tileError.value = true
    })
    .on('tileload', () => {
      tileError.value = false
    })
    .addTo(map)
  layer = L.layerGroup().addTo(map)
  draw()
  tick = setInterval(() => {
    if (document.visibilityState !== 'visible') return
    refreshClock()
    if (helpId.value && document.visibilityState === 'visible')
      void refreshHelpStatus().catch(() => {})
  }, 10000)
})
onUnmounted(() => {
  alive = false
  document.removeEventListener('visibilitychange', refreshClock)
  if (tick) clearInterval(tick)
  map?.remove()
  map = null
  layer = null
})
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">NÄRA VARANDRA</span>
      <h1>Familjekarta</h1>
      <p>Senast rapporterade positioner. GPS uppdateras när appen är aktiv.</p>
    </div>
  </div>
  <p class="small map-live-status" role="status">
    {{
      mapStatus === 'loading'
        ? 'Hämtar familjens positioner…'
        : mapStatus === 'unconfigured'
          ? 'Registrering och Supabase krävs.'
          : mapSync
    }}
    ·
    {{
      geoWatching
        ? 'GPS används när appen är synlig'
        : 'Ingen aktiv GPS-bevakning'
    }}
  </p>
  <div v-if="geoPermission !== 'granted'" class="notice">
    <p>
      {{
        geoPermission === 'denied'
          ? 'Platsbehörighet saknas. Tillåt plats för Familjen i telefonens eller webbläsarens inställningar.'
          : geoPermission === 'unsupported'
            ? 'GPS stöds inte i den här webbläsaren.'
            : 'Tillåt plats för att visa familjen din position när appen används.'
      }}
    </p>
    <button
      v-if="geoPermission === 'prompt'"
      class="primary-button"
      :disabled="busy || !identity"
      @click="locate"
    >
      Tillåt plats
    </button>
  </div>
  <p v-if="geoError" class="notice" role="alert">{{ geoError }}</p>
  <p v-if="mapError" class="notice" role="alert">
    {{ mapError }} <button @click="reloadMap">Försök igen</button>
  </p>
  <p v-if="error && !showHelp" class="notice" role="alert">{{ error }}</p>
  <p v-if="tileError" class="notice" role="status">
    Delar av bakgrundskartan kunde inte laddas. Positionslistan och hjälpknappen
    fungerar fortfarande när Supabase är anslutet.
  </p>
  <section
    ref="container"
    class="family-map-container"
    aria-label="Familjens karta"
  >
    <div
      ref="element"
      class="family-map"
      aria-label="Karta med familjens senast rapporterade positioner"
    ></div>
    <div class="map-actions">
      <button
        aria-label="Centrera på min position"
        :disabled="busy || !identity"
        @click="own ? center(own.profile_id) : locate()"
      >
        <Crosshair :size="20" /></button
      ><button
        aria-label="Visa hela familjen"
        :disabled="!mapData.positions.length"
        @click="fitFamily"
      >
        <UsersRound :size="20" /></button
      ><button aria-label="Stor kartvy" @click="expand">
        <Maximize2 :size="20" />
      </button>
    </div>
    <span v-if="!mapData.positions.length && !linked" class="map-empty"
      >Ingen familjeposition har rapporterats ännu.</span
    >
  </section>
  <p v-if="linkMessage" class="notice" role="status">{{ linkMessage }}</p>
  <p v-if="linked" class="notice">
    Hjälpposition från {{ positionTime(linked.timestamp) }} ·
    {{ ageStatus(linked.timestamp, now).label }}. Den visar platsen vid den
    tidpunkten.
  </p>
  <div class="map-person-list">
    <button
      v-for="row in rows"
      :key="row.person.id"
      class="map-person panel"
      :disabled="!row.position"
      @click="center(row.person.id)"
    >
      <span class="avatar" :class="color(row.person.key)">{{
        row.person.name[0]
      }}</span>
      <span class="map-person-info"
        ><strong
          >{{ row.person.name
          }}{{ row.person.id === identity?.profile_id ? ' · Du' : '' }}</strong
        ><span
          :class="[
            'position-age',
            ageStatus(
              row.position ? Date.parse(row.position.reported_at) : null,
              now,
            ).level,
          ]"
          >{{
            ageStatus(
              row.position ? Date.parse(row.position.reported_at) : null,
              now,
            ).label
          }}<template v-if="row.position">
            ·
            {{ ageLabel(Date.parse(row.position.reported_at), now) }}</template
          ></span
        ><small v-if="row.position"
          >GPS {{ positionTime(row.position.reported_at) }}<br />Server
          {{ positionTime(row.position.received_at) }} · ±{{
            Math.round(row.position.accuracy)
          }}
          m</small
        ><small v-else>Ingen GPS-position rapporterad.</small></span
      >
    </button>
  </div>
  <button
    class="help-button"
    :disabled="preparing || busy || !identity"
    @click="prepareHelp"
  >
    <HandHeart :size="21" />{{
      preparing ? 'Hämtar färsk GPS…' : 'Be familjen om hjälp'
    }}
  </button>
  <p class="small">
    Hjälpmeddelandet skickas till familjechatten. Funktionen ersätter inte 112.
    När appen är stängd eller i bakgrunden kan GPS inte uppdateras
    kontinuerligt.
  </p>
  <section v-if="helpId" class="panel help-result" role="status">
    <h2>Hjälpmeddelandet har skickats till chatten</h2>
    <p v-if="!helpDeliveries.length">Pushstatus kunde inte bekräftas ännu.</p>
    <p v-for="d in helpDeliveries" :key="d.name">
      <strong>{{ d.name }}</strong
      >: {{ helpDeliveryLabel(d) }}
    </p>
    <RouterLink to="/chatt" class="text-link">Öppna chatten</RouterLink>
  </section>
  <dialog
    v-if="showHelp"
    ref="helpDialog"
    aria-labelledby="help-title"
    @cancel.prevent="!busy && (showHelp = false)"
  >
    <div class="dialog-head">
      <h2 id="help-title">Skicka hjälpmeddelande?</h2>
      <button aria-label="Stäng" :disabled="busy" @click="showHelp = false">
        <X />
      </button>
    </div>
    <p>
      Familjen får ett prioriterat chattmeddelande och en pushnotis om deras
      telefoner kan ta emot den.
    </p>
    <p v-if="candidate" class="notice">
      {{ ageStatus(candidate.timestamp, now).label }} ·
      {{ positionTime(candidate.timestamp) }}<br />{{
        candidate.latitude.toFixed(5)
      }}, {{ candidate.longitude.toFixed(5) }} · ±{{
        Math.round(candidate.accuracy)
      }}
      m
    </p>
    <p v-else class="notice">
      GPS-position saknas. Meddelandet skickas utan koordinater.
    </p>
    <p v-if="candidate && now - candidate.timestamp >= 120000" class="notice">
      Positionen är gammal och kan visa en annan plats än där du är nu.
    </p>
    <p v-if="error" role="alert" class="notice">{{ error }}</p>
    <div class="form-actions">
      <button
        class="secondary-button"
        :disabled="busy"
        @click="showHelp = false"
      >
        Avbryt</button
      ><button class="help-button" :disabled="busy" @click="confirmHelp">
        {{ busy ? 'Skickar…' : 'Ja, skicka hjälpmeddelande' }}
      </button>
    </div>
  </dialog>
</template>
