import { supabase } from '../services/supabase'
import type { ChatMessage, ChatSummary } from '../domain/chat'
export interface ChatRepository {
  page(
    before: number | null,
    after?: number | null,
    limit?: number,
  ): Promise<ChatMessage[]>
  summary(): Promise<ChatSummary>
  send(body: string, request: string): Promise<ChatMessage>
  change(
    id: string,
    body: string,
    version: number,
    remove: boolean,
  ): Promise<ChatMessage>
  read(seq: number): Promise<void>
  preferences(enabled: boolean): Promise<void>
  subscribe(
    change: (message: ChatMessage | null) => void,
    status: (s: string) => void,
  ): () => void
}
export function createChatRepository(): ChatRepository | null {
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
    page: (before, after = null, limit = 40) =>
      rpc('chat_page', {
        before_seq: before,
        after_seq: after,
        page_limit: limit,
      }),
    summary: () => rpc('chat_summary'),
    send: (body, request) =>
      rpc('chat_send', { message_body: body, request_id: request }),
    change: (id, body, version, remove) =>
      rpc('chat_change', {
        message_id: id,
        message_body: body,
        expected_version: version,
        remove_message: remove,
      }),
    read: (seq) => rpc('chat_mark_read', { through_seq: seq }),
    preferences: (enabled) => rpc('chat_preferences', { enabled }),
    subscribe(change, status) {
      const channel = client.channel('family-chat-changes')
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_messages' },
        (payload) =>
          change(
            payload.new && 'seq' in payload.new
              ? (payload.new as ChatMessage)
              : null,
          ),
      )
      for (const table of ['chat_read_states', 'notification_preferences'])
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          () => change(null),
        )
      channel.subscribe((s) => {
        status(s)
        if (s === 'SUBSCRIBED') change(null)
      })
      return () => {
        void client.removeChannel(channel)
      }
    },
  }
}
