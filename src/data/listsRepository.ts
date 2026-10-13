import { supabase } from '../services/supabase'
import type {
  ListKind,
  ListsSnapshot,
  TaskInput,
  ShoppingInput,
} from '../domain/lists'
export interface ListsRepository {
  load(): Promise<ListsSnapshot>
  save(
    kind: ListKind,
    payload: TaskInput | ShoppingInput,
    id: string | null,
    version: number | null,
    request: string,
  ): Promise<string>
  setDone(
    kind: ListKind,
    id: string,
    done: boolean,
    version: number,
  ): Promise<string>
  remove(kind: ListKind, id: string, version: number): Promise<void>
  subscribe(change: () => void, status: (s: string) => void): () => void
}
export function createListsRepository(): ListsRepository | null {
  if (!supabase) return null
  const client = supabase
  async function rpc<T>(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    const { data, error } = await client
      .rpc(fn, args)
      .abortSignal(AbortSignal.timeout(20000))
    if (error) throw new Error(error.message)
    return data as T
  }
  return {
    load: () => rpc('lists_snapshot'),
    save: (kind, payload, id, version, request) =>
      rpc('lists_save', {
        kind,
        payload,
        item_id: id,
        expected_version: version,
        request_id: request,
      }),
    setDone: (kind, id, done, version) =>
      rpc('lists_set_done', {
        kind,
        item_id: id,
        done,
        expected_version: version,
      }),
    remove: async (kind, id, version) => {
      await rpc('lists_delete', {
        kind,
        item_id: id,
        expected_version: version,
      })
    },
    subscribe(change, status) {
      const channel = client.channel('family-lists-changes')
      for (const table of ['tasks', 'task_assignees', 'shopping_items'])
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          change,
        )
      channel.subscribe((s) => {
        status(s)
        if (s === 'SUBSCRIBED') change()
      })
      return () => {
        void client.removeChannel(channel)
      }
    },
  }
}
