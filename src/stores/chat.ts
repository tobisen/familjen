import { ref, computed } from 'vue'
import {
  createChatRepository,
  type ChatRepository,
} from '../data/chatRepository'
import {
  mergeMessages,
  type ChatMessage,
  type ChatSummary,
} from '../domain/chat'
export const messages = ref<ChatMessage[]>([])
export const chatSummary = ref<ChatSummary>({
  last_message: null,
  unread: 0,
  last_read_seq: 0,
  chat_enabled: true,
  people: [],
})
export const chatStatus = ref<'unconfigured' | 'loading' | 'ready' | 'error'>(
  'unconfigured',
)
export const chatError = ref(''),
  chatSync = ref('Ej ansluten'),
  chatOnline = ref(navigator.onLine)
export const chatWritable = computed(
  () => chatStatus.value === 'ready' && chatOnline.value,
)
export const hasOlder = ref(false),
  loadingOlder = ref(false),
  chatActive = ref(false),
  chatAtBottom = ref(true)
export const pendingMessages = ref<
  {
    request: string
    body: string
    status: 'sending' | 'failed'
    error: string
  }[]
>([])
let repository: ChatRepository | null = null,
  unsubscribe: (() => void) | null = null,
  generation = 0,
  loaded = false
let refreshing: Promise<void> | null = null,
  dirty = false,
  reading = false
export function stopChat() {
  generation++
  unsubscribe?.()
  unsubscribe = null
  repository = null
  loaded = false
  refreshing = null
  dirty = false
  reading = false
  messages.value = []
  pendingMessages.value = []
  chatStatus.value = 'unconfigured'
  chatError.value = ''
  chatSync.value = 'Ej ansluten'
  chatSummary.value = {
    last_message: null,
    unread: 0,
    last_read_seq: 0,
    chat_enabled: true,
    people: [],
  }
  chatActive.value = false
  chatAtBottom.value = true
  hasOlder.value = false
  loadingOlder.value = false
}
export async function refreshChat() {
  if (!repository) return
  if (refreshing) {
    dirty = true
    return refreshing
  }
  const token = generation,
    r = repository
  refreshing = (async () => {
    do {
      dirty = false
      try {
        if (loaded) {
          let cursor = (messages.value[0]?.seq ?? 1) - 1
          for (;;) {
            const rows = await r.page(null, cursor, 100)
            if (token !== generation) return
            messages.value = mergeMessages(messages.value, rows)
            if (rows.length < 100) break
            cursor = rows.at(-1)!.seq
          }
        }
        const summary = await r.summary()
        if (token !== generation) return
        chatSummary.value = summary
        chatStatus.value = 'ready'
        chatError.value = ''
        if (chatActive.value && chatAtBottom.value) void markChatRead()
      } catch (e) {
        if (token !== generation) return
        chatStatus.value = 'error'
        chatError.value =
          e instanceof Error ? e.message : 'Chatten kunde inte hämtas.'
      }
    } while (dirty && token === generation)
  })()
  const work = refreshing
  try {
    await work
  } finally {
    if (refreshing === work) refreshing = null
  }
}
export function startChat(injected?: ChatRepository) {
  if (repository && !injected) {
    void refreshChat()
    return
  }
  stopChat()
  repository = injected ?? createChatRepository()
  if (!repository) return
  chatStatus.value = 'loading'
  void refreshChat()
  const subscriptionGeneration = generation
  unsubscribe = repository.subscribe(
    (message) => {
      if (subscriptionGeneration !== generation) return
      if (message && loaded) {
        messages.value = mergeMessages(messages.value, [message])
        // Realtime may confirm delivery before the RPC response reaches this device.
        pendingMessages.value = pendingMessages.value.filter(
          (p) => p.request !== message.client_request_id,
        )
      }
      void refreshChat()
    },
    (status) => {
      if (subscriptionGeneration !== generation) return
      chatSync.value =
        status === 'SUBSCRIBED'
          ? 'Realtid ansluten'
          : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT'
            ? 'Realtid avbruten · återansluter'
            : 'Ansluter'
    },
  )
}
export async function openChat() {
  chatActive.value = true
  chatAtBottom.value = true
  if (!repository) return
  const token = generation
  try {
    if (!loaded) {
      const rows = await repository.page(null)
      if (token !== generation) return
      messages.value = mergeMessages(messages.value, rows)
      hasOlder.value = rows.length === 40
      loaded = true
    }
    await refreshChat()
    if (token === generation) await markChatRead()
  } catch (e) {
    if (token === generation)
      chatError.value =
        e instanceof Error ? e.message : 'Kunde inte öppna chatten.'
  }
}
export async function loadOlder() {
  if (!repository || loadingOlder.value || !hasOlder.value) return
  const r = repository,
    token = generation
  loadingOlder.value = true
  try {
    const rows = await r.page(messages.value[0]?.seq ?? null)
    if (token !== generation) return
    messages.value = mergeMessages(messages.value, rows)
    hasOlder.value = rows.length === 40
    chatError.value = ''
  } catch (e) {
    if (token === generation)
      chatError.value =
        e instanceof Error ? e.message : 'Kunde inte hämta äldre meddelanden.'
  } finally {
    if (token === generation) loadingOlder.value = false
  }
}
export async function markChatRead() {
  const seq = messages.value.at(-1)?.seq
  if (
    !repository ||
    !seq ||
    reading ||
    !chatActive.value ||
    !chatAtBottom.value ||
    document.visibilityState !== 'visible' ||
    seq <= chatSummary.value.last_read_seq
  )
    return
  const r = repository,
    token = generation
  reading = true
  try {
    await r.read(seq)
    if (token !== generation) return
    chatSummary.value.last_read_seq = Math.max(
      seq,
      chatSummary.value.last_read_seq,
    )
    await refreshChat()
  } catch (e) {
    if (token === generation)
      chatError.value =
        e instanceof Error ? e.message : 'Lässtatus kunde inte sparas.'
  } finally {
    if (token === generation) reading = false
  }
}
export async function sendMessage(
  body: string,
  request: string = crypto.randomUUID(),
) {
  if (
    pendingMessages.value.some(
      (p) => p.request === request && p.status === 'sending',
    )
  )
    return
  if (!body.trim() || body.trim().length > 10000)
    throw new Error('Skriv 1–10 000 tecken.')
  const existing = pendingMessages.value.find((p) => p.request === request)
  const pending = existing ?? {
    request,
    body: body.trim(),
    status: 'sending' as const,
    error: '',
  }
  if (!existing) pendingMessages.value.push(pending)
  const row = pendingMessages.value.find((p) => p.request === request)!
  row.status = 'sending'
  row.error = ''
  const r = repository,
    token = generation
  try {
    if (!r || !chatOnline.value)
      throw new Error(
        'Nätverk och en registrerad enhet krävs. Försök igen när du är online.',
      )
    const message = await r.send(row.body, request)
    if (token !== generation) return
    messages.value = mergeMessages(messages.value, [message])
    pendingMessages.value = pendingMessages.value.filter(
      (p) => p.request !== request,
    )
    await refreshChat()
  } catch (e) {
    if (token !== generation) return
    row.status = 'failed'
    row.error = e instanceof Error ? e.message : 'Kunde inte skicka.'
  }
}
export async function changeMessage(
  message: ChatMessage,
  body: string,
  remove = false,
) {
  if (!repository || !chatOnline.value) throw new Error('Nätanslutning krävs.')
  const token = generation,
    result = await repository.change(message.id, body, message.version, remove)
  if (token !== generation) throw new Error('Sessionen har ändrats.')
  messages.value = mergeMessages(messages.value, [result])
  await refreshChat()
}
export async function setChatNotifications(enabled: boolean) {
  if (!repository || !chatOnline.value) throw new Error('Nätanslutning krävs.')
  const token = generation
  await repository.preferences(enabled)
  if (token === generation) await refreshChat()
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    chatOnline.value = true
    void refreshChat()
  })
  window.addEventListener('offline', () => {
    chatOnline.value = false
  })
  window.addEventListener('focus', () => {
    void refreshChat()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshChat()
  })
}
