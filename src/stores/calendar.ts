import { computed, ref } from 'vue'
import {
  createCalendarRepository,
  type CalendarRepository,
} from '../data/calendarRepository'
import type {
  ActivityInput,
  CalendarActivity,
  CalendarPerson,
  PublicSchoolLesson,
  Occurrence,
} from '../domain/calendar'
export const people = ref<CalendarPerson[]>([])
export const activities = ref<CalendarActivity[]>([])
export const schoolLessons = ref<PublicSchoolLesson[]>([])
export const calendarStatus = ref<
  'unconfigured' | 'loading' | 'ready' | 'error'
>('unconfigured')
export const calendarError = ref('')
export const syncStatus = ref('Ansluter')
export const saving = ref(false)
let repository: CalendarRepository | null = null
let unsubscribe: (() => void) | null = null
let request = 0
export const isOnline = ref(navigator.onLine)
export const canWrite = computed(
  () => calendarStatus.value === 'ready' && isOnline.value,
)
export async function reloadCalendar() {
  if (!repository) return
  const token = ++request
  try {
    const snapshot = await repository.load()
    if (token !== request) return
    people.value = snapshot.people
    activities.value = snapshot.activities
    schoolLessons.value = snapshot.lessons
    calendarStatus.value = 'ready'
    calendarError.value = ''
  } catch (e) {
    if (token !== request) return
    calendarStatus.value = 'error'
    calendarError.value =
      e instanceof Error ? e.message : 'Kalendern kunde inte hämtas.'
  }
}
export function startCalendar(injected?: CalendarRepository) {
  unsubscribe?.()
  repository = injected ?? createCalendarRepository()
  if (!repository) {
    calendarStatus.value = 'unconfigured'
    return
  }
  calendarStatus.value = 'loading'
  void reloadCalendar()
  unsubscribe = repository.subscribe(
    () => {
      void reloadCalendar()
    },
    (status) =>
      (syncStatus.value =
        status === 'SUBSCRIBED'
          ? 'Realtid ansluten'
          : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT'
            ? 'Realtid avbruten · återansluter'
            : 'Ansluter'),
  )
}
export async function saveActivity(
  input: ActivityInput,
  id: string | null,
  version: number | null,
) {
  if (!repository || !navigator.onLine)
    throw new Error('Kalenderanslutning och nätverk krävs.')
  saving.value = true
  try {
    const result = await repository.save(input, id, version)
    await reloadCalendar()
    return result
  } finally {
    saving.value = false
  }
}
export async function deleteActivity(id: string, version: number) {
  if (!repository || !navigator.onLine)
    throw new Error('Kalenderanslutning och nätverk krävs.')
  saving.value = true
  try {
    await repository.remove(id, version)
    await reloadCalendar()
  } finally {
    saving.value = false
  }
}
export async function importSchool(rows: Omit<PublicSchoolLesson, 'id'>[]) {
  if (!repository || !navigator.onLine)
    throw new Error('Kalenderanslutning och nätverk krävs.')
  saving.value = true
  try {
    const count = await repository.importLessons(rows)
    await reloadCalendar()
    return count
  } finally {
    saving.value = false
  }
}
export const editor = ref<{
  id: string | null
  date: string
  time: string
  allDay?: boolean
  occurrence: Occurrence | null
} | null>(null)
export const detail = ref<Occurrence | null>(null)
export function openCreate(date: string, time = '09:00', allDay = false) {
  editor.value = { id: null, date, time, allDay, occurrence: null }
}
export function openEdit(o: Occurrence) {
  detail.value = null
  editor.value = {
    id: o.activity.id,
    date: o.date,
    time: '09:00',
    occurrence: o,
  }
}
// Reload after a background tab resumes and when network returns, as a Realtime safety net.
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => {
    isOnline.value = false
  })
  window.addEventListener('online', () => {
    isOnline.value = true
    void reloadCalendar()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void reloadCalendar()
  })
}
