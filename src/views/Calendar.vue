<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { Temporal } from '@js-temporal/polyfill'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Upload,
} from 'lucide-vue-next'
import {
  today,
  addDays,
  dateLabel,
  weekStart,
  monthGrid,
  occurrences,
  onDay,
  localParts,
} from '../domain/calendar'
import {
  people,
  activities,
  schoolLessons,
  calendarStatus,
  calendarError,
  syncStatus,
  reloadCalendar,
  openCreate,
  canWrite,
} from '../stores/calendar'
import CalendarEvent from '../components/CalendarEvent.vue'
import SchoolImport from '../components/SchoolImport.vue'
const view = ref<'day' | 'week' | 'month'>('week')
const date = ref(today())
const selectedPeople = ref<string[]>([])
const category = ref('all')
const showLunch = ref(true)
const showImport = ref(false)
const days = computed(() =>
  view.value === 'day'
    ? [date.value]
    : view.value === 'week'
      ? Array.from({ length: 7 }, (_, i) => addDays(weekStart(date.value), i))
      : monthGrid(date.value),
)
const visible = computed(() =>
  occurrences(
    activities.value,
    schoolLessons.value.filter(
      (l) =>
        showLunch.value || l.subject.trim().toLocaleLowerCase('sv') !== 'lunch',
    ),
    days.value[0]!,
    addDays(days.value.at(-1)!, 1),
    selectedPeople.value,
    category.value,
  ),
)
const heading = computed(() =>
  view.value === 'month'
    ? dateLabel(date.value, { month: 'long', year: 'numeric' })
    : view.value === 'day'
      ? dateLabel(date.value, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })
      : `${dateLabel(days.value[0]!)} – ${dateLabel(days.value.at(-1)!)}`,
)
const timelineElement = ref<HTMLElement | null>(null)
async function scrollToMorning() {
  await nextTick()
  if (timelineElement.value) timelineElement.value.scrollTop = 7 * 60
}
onMounted(scrollToMorning)
watch(view, scrollToMorning)
const hours = Array.from({ length: 24 }, (_, i) => i)
function move(direction: number) {
  date.value =
    view.value === 'month'
      ? Temporal.PlainDate.from(date.value)
          .add({ months: direction })
          .toString()
      : addDays(date.value, direction * (view.value === 'week' ? 7 : 1))
}
function items(day: string) {
  return visible.value.filter((o) => onDay(o, day))
}
function timed(day: string) {
  return items(day).filter((o) => !o.activity.all_day)
}
function layout(day: string) {
  const list = timed(day)
  const lanes: number[] = []
  const result = list.map((o) => {
    const start = localParts(o.starts_at)
    const end = localParts(o.ends_at)
    const sm =
      start.date < day
        ? 0
        : Number(start.time.slice(0, 2)) * 60 + Number(start.time.slice(3))
    const em =
      end.date > day
        ? 1440
        : Number(end.time.slice(0, 2)) * 60 + Number(end.time.slice(3))
    const occupiedEnd = Math.max(sm + 26, em)
    let lane = lanes.findIndex((e) => e <= sm)
    if (lane < 0) lane = lanes.length
    lanes[lane] = occupiedEnd
    return { o, sm, em, lane }
  })
  const width = 100 / Math.max(lanes.length, 1)
  return result.map((x) => ({
    ...x,
    style: {
      top: `${x.sm}px`,
      height: `${Math.max(x.em - x.sm, 26)}px`,
      left: `${x.lane * width}%`,
      width: `${width}%`,
    },
  }))
}
function createAt(day: string, hour: number) {
  if (canWrite.value) openCreate(day, `${String(hour).padStart(2, '0')}:00`)
}
function openDay(day: string) {
  date.value = day
  view.value = 'day'
}
const off = ref(!navigator.onLine)
window.addEventListener('offline', () => (off.value = true))
window.addEventListener('online', () => (off.value = false))
</script>
<template>
  <div class="page-heading calendar-page-heading">
    <div>
      <span class="eyebrow">VÅR GEMENSAMMA VARDAG</span>
      <h1>Kalender</h1>
      <p>Planer, skoldagar och tid tillsammans.</p>
    </div>
    <button class="secondary-button" @click="showImport = true">
      <Upload :size="17" />Importera schema
    </button>
  </div>
  <p class="public-warning">
    Privat kalender · delas endast med registrerade familjemedlemmar.
  </p>
  <div class="calendar-controls">
    <div class="tabs" aria-label="Kalendervy">
      <button
        v-for="[value, label] in [
          ['day', 'Dag'],
          ['week', 'Vecka'],
          ['month', 'Månad'],
        ]"
        :key="value"
        :aria-pressed="view === value"
        @click="view = value as typeof view"
      >
        {{ label }}
      </button>
    </div>
    <div class="calendar-period">
      <button aria-label="Föregående period" @click="move(-1)">
        <ChevronLeft />
      </button>
      <h2>{{ heading }}</h2>
      <button aria-label="Nästa period" @click="move(1)">
        <ChevronRight /></button
      ><button class="secondary-button" @click="date = today()">Idag</button>
    </div>
  </div>
  <div class="calendar-filters">
    <fieldset>
      <legend>Personer (ingen vald = alla)</legend>
      <label
        v-for="p in people.length
          ? people
          : [
              { id: 'tobias', display_name: 'Tobias', color: 'blue' },
              { id: 'neo', display_name: 'Neo', color: 'green' },
              { id: 'sally', display_name: 'Sally', color: 'orange' },
            ]"
        :key="p.id"
        class="person-chip"
        :class="p.color"
        ><input v-model="selectedPeople" type="checkbox" :value="p.id" />{{
          p.display_name
        }}</label
      >
    </fieldset>
    <label
      >Kategori<select v-model="category">
        <option value="all">Alla</option>
        <option value="family">Familj</option>
        <option value="school">Skola</option>
      </select></label
    >
  </div>
  <label class="check-label"
    ><input v-model="showLunch" type="checkbox" />Visa luncher</label
  >
  <p v-if="calendarStatus === 'loading'" role="status" class="notice">
    Hämtar kalendern…
  </p>
  <p v-if="calendarStatus === 'unconfigured'" role="status" class="notice">
    Supabase är inte konfigurerat. Kalendern kan visas men inga aktiviteter
    hämtas eller sparas.
  </p>
  <div v-if="calendarStatus === 'error'" role="alert" class="notice">
    {{ calendarError }} <button @click="reloadCalendar">Försök igen</button>
  </div>
  <p v-if="off" class="notice">
    Offline: visade aktiviteter kan vara gamla. Återanslut för att spara.
  </p>
  <div class="calendar-meta">
    <span
      >{{ calendarStatus === 'ready' ? syncStatus : 'Ingen datakoppling' }} ·
      Europe/Stockholm</span
    ><button
      v-if="calendarStatus === 'ready'"
      aria-label="Uppdatera kalender"
      @click="reloadCalendar"
    >
      <RefreshCw :size="16" /></button
    ><button
      class="primary-button"
      :disabled="!canWrite || off"
      @click="openCreate(date)"
    >
      <Plus :size="17" />Ny aktivitet
    </button>
  </div>
  <div v-if="view === 'month'" class="month-grid">
    <div
      v-for="day in days"
      :key="day"
      class="month-day"
      :class="{
        'other-month': day.slice(0, 7) !== date.slice(0, 7),
        'is-today': day === today(),
      }"
    >
      <button
        class="day-label"
        :aria-label="`Visa ${day}`"
        @click="openDay(day)"
      >
        {{ dateLabel(day, { weekday: 'short', day: 'numeric' }) }}</button
      ><CalendarEvent
        v-for="o in items(day).slice(0, 3)"
        :key="o.key"
        :occurrence="o"
        compact
      /><button
        v-if="items(day).length > 3"
        class="more-events"
        @click="openDay(day)"
      >
        +{{ items(day).length - 3 }} till</button
      ><button
        v-if="canWrite"
        class="month-add"
        :aria-label="`Ny aktivitet ${day}`"
        @click="openCreate(day)"
      >
        +
      </button>
    </div>
  </div>
  <div v-else ref="timelineElement" class="timeline-scroll">
    <div class="timeline" :class="{ 'single-day': view === 'day' }">
      <div class="time-gutter">
        <div class="timeline-day-heading">Tid</div>
        <div class="all-day-label">Heldag</div>
        <div class="hours">
          <span v-for="h in hours" :key="h" :style="{ top: `${h * 60}px` }"
            >{{ String(h).padStart(2, '0') }}:00</span
          >
        </div>
      </div>
      <div
        v-for="day in days"
        :key="day"
        class="timeline-column"
        :class="{ 'is-today': day === today() }"
      >
        <button class="timeline-day-heading" @click="openDay(day)">
          {{ dateLabel(day, { weekday: 'short', day: 'numeric' }) }}
        </button>
        <div class="all-day-events">
          <CalendarEvent
            v-for="o in items(day).filter((o) => o.activity.all_day)"
            :key="o.key"
            :occurrence="o"
            compact
          /><button
            :disabled="!canWrite || off"
            :aria-label="`Ny heldag ${day}`"
            @click="openCreate(day, '00:00', true)"
          >
            +
          </button>
        </div>
        <div class="time-slots">
          <button
            v-for="h in hours"
            :key="h"
            class="time-slot"
            :disabled="!canWrite || off"
            :aria-label="`Ny aktivitet ${day} ${String(h).padStart(2, '0')}:00`"
            @click="createAt(day, h)"
          ></button>
          <div
            v-for="x in layout(day)"
            :key="x.o.key"
            class="positioned-event"
            :style="x.style"
          >
            <CalendarEvent :occurrence="x.o" compact />
          </div>
        </div>
      </div>
    </div>
  </div>
  <p
    v-if="calendarStatus === 'ready' && !visible.length"
    class="calendar-empty"
  >
    Inga aktiviteter under den här perioden med valda filter.
  </p>
  <p class="small">
    Veckovyn går att svepa i sidled på mobilen. Tryck på en tom timme för att
    skapa eller på en aktivitet för detaljer.
  </p>
  <SchoolImport v-if="showImport" @close="showImport = false" />
</template>
