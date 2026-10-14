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
  saveOccurrence?(
    input: ActivityInput,
    id: string,
    date: string,
    version: number,
  ): Promise<string>
  participate?(id: string, version: number, join: boolean): Promise<void>
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
    saveOccurrence: (input, id, date, version) =>
      rpc('calendar_save_occurrence', {
        payload: input,
        event_id: id,
        occurrence_date: date,
        expected_version: version,
      }),
    participate: (id, version, join) =>
      rpc('calendar_participate', {
        event_id: id,
        expected_version: version,
        joining: join,
      }),
    load: () => rpc<CalendarSnapshot>('calendar_snapshot'),
    save: (input, id, version) =>
      rpc<string>('calendar_save', {
        payload: input,
        event_id: id,
        expected_version: version,
      }),
    remove: async (id, version) => {
      await rpc('calendar_delete', {
        event_id: id,
        expected_version: version,
      })
    },
    importLessons: (rows) => rpc<number>('calendar_import', { lessons: rows }),
    subscribe(onChange, onStatus) {
      const channel = client.channel('family-calendar-changes')
      for (const table of [
        'private_calendar_events',
        'private_school_lessons',
        'private_calendar_people',
        'private_calendar_settings',
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
