import { supabase } from '../services/supabase'
import type {
  ActivityInput,
  CalendarActivity,
  CalendarPerson,
  PublicSchoolLesson,
} from '../domain/calendar'
export interface CalendarSnapshot {
  people: CalendarPerson[]
  activities: CalendarActivity[]
  lessons: PublicSchoolLesson[]
}
export interface CalendarRepository {
  load(): Promise<CalendarSnapshot>
  save(
    input: ActivityInput,
    id: string | null,
    version: number | null,
  ): Promise<string>
  remove(id: string, version: number): Promise<void>
  importLessons(rows: Omit<PublicSchoolLesson, 'id'>[]): Promise<number>
  subscribe(
    onChange: () => void,
    onStatus: (status: string) => void,
  ): () => void
}
export function createCalendarRepository(): CalendarRepository | null {
  if (!supabase) return null
  const client = supabase
  async function rpc<T>(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    const { data, error } = await client.rpc(fn, args)
    if (error) throw new Error(error.message)
    return data as T
  }
  return {
    load: () => rpc<CalendarSnapshot>('public_calendar_snapshot'),
    save: (input, id, version) =>
      rpc<string>('public_calendar_save', {
        payload: input,
        event_id: id,
        expected_version: version,
      }),
    remove: async (id, version) => {
      await rpc('public_calendar_delete', {
        event_id: id,
        expected_version: version,
      })
    },
    importLessons: (rows) =>
      rpc<number>('public_calendar_import', { lessons: rows }),
    subscribe(onChange, onStatus) {
      const channel = client.channel('public-calendar-changes')
      for (const table of [
        'open_calendar_events',
        'open_school_lessons',
        'open_calendar_people',
        'open_calendar_settings',
      ])
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          onChange,
        )
      channel.subscribe((status) => {
        onStatus(status)
        if (status === 'SUBSCRIBED') onChange()
      })
      return () => {
        void client.removeChannel(channel)
      }
    },
  }
}
