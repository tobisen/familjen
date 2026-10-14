import type { ListPerson } from './lists'
export interface ChatMessage {
  id: string
  seq: number
  sender_id: string
  body: string
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  version: number
  client_request_id: string | null
}
export interface ChatSummary {
  last_message: ChatMessage | null
  unread: number
  last_read_seq: number
  chat_enabled: boolean
  people: ListPerson[]
}
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const map = new Map(current.map((m) => [m.id, m]))
  for (const message of incoming) {
    const old = map.get(message.id)
    if (!old || old.version <= message.version) map.set(message.id, message)
  }
  return [...map.values()].sort((a, b) => a.seq - b.seq)
}
export function chatDate(value: string) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value))
}
export function chatTime(value: string) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
// Render text nodes only. Only explicit HTTP(S) URLs become links; no HTML/Markdown parsing.
export function messageParts(body: string): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = []
  let offset = 0
  for (const match of body.matchAll(/https?:\/\/[^\s<>"'\p{Cc}]+/giu)) {
    const at = match.index!,
      value = match[0].replace(/[.,!?;:)\]}]+$/, '')
    if (at > offset) parts.push({ text: body.slice(offset, at) })
    try {
      const url = new URL(value)
      parts.push(
        url.protocol === 'https:' || url.protocol === 'http:'
          ? { text: value, href: url.href }
          : { text: value },
      )
    } catch {
      parts.push({ text: value })
    }
    offset = at + value.length
  }
  if (offset < body.length) parts.push({ text: body.slice(offset) })
  return parts.length ? parts : [{ text: body }]
}
export function shouldSend(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'isComposing'>,
  mobile: boolean,
) {
  return (
    !mobile && event.key === 'Enter' && !event.shiftKey && !event.isComposing
  )
}
