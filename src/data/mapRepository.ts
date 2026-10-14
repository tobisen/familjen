import { supabase } from '../services/supabase'
import type { MapSnapshot, Sample, HelpDelivery } from '../domain/location'
export interface MapRepository {
  load(): Promise<MapSnapshot>
  report(sample: Sample): Promise<{ accepted: boolean }>
  help(sample: Sample | null, request: string): Promise<string>
  helpPosition(
    id: string,
  ): Promise<{ position: Sample | null; name: string; created_at: string }>
  helpStatus(id: string): Promise<HelpDelivery[]>
  subscribe(change: () => void, status: (value: string) => void): () => void
}
export function createMapRepository(): MapRepository | null {
  if (!supabase) return null
  const client = supabase
  async function rpc<T>(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    const { data, error } = await client
      .rpc(name, args)
      .abortSignal(AbortSignal.timeout(15000))
    if (error) throw Error(error.message)
    return data as T
  }
  const fields = (s: Sample | null) => ({
    latitude: s?.latitude ?? null,
    longitude: s?.longitude ?? null,
    accuracy: s?.accuracy ?? null,
    recorded_at: s ? new Date(s.timestamp).toISOString() : null,
  })
  return {
    load: () => rpc('map_snapshot'),
    report: (s) => rpc('map_report', fields(s)),
    help: (s, request) =>
      rpc('map_help', { request_id: request, ...fields(s) }),
    helpPosition: (id) => rpc('map_help_position', { message_id: id }),
    helpStatus: (id) => rpc('map_help_status', { message_id: id }),
    subscribe(change, status) {
      const channel = client
        .channel('family-map-changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'positions' },
          change,
        )
        .subscribe((s) => {
          status(s)
          if (s === 'SUBSCRIBED') change()
        })
      return () => {
        void client.removeChannel(channel)
      }
    },
  }
}
