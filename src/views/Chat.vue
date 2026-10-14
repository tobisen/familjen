<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { Send, ChevronDown, Pencil, Trash2, X } from 'lucide-vue-next'
import { identity } from '../stores/auth'
import { profiles } from '../domain/profiles'
import {
  chatDate,
  chatTime,
  messageParts,
  shouldSend,
  type ChatMessage,
} from '../domain/chat'
import {
  messages,
  chatSummary,
  chatStatus,
  chatSync,
  chatError,
  chatWritable,
  pendingMessages,
  hasOlder,
  loadingOlder,
  chatActive,
  chatAtBottom,
  openChat,
  refreshChat,
  loadOlder,
  markChatRead,
  sendMessage,
  changeMessage,
} from '../stores/chat'
const scroller = ref<HTMLElement | null>(null),
  composer = ref<HTMLTextAreaElement | null>(null),
  draft = ref(''),
  error = ref(''),
  opening = ref(true)
const editing = ref<ChatMessage | null>(null),
  editBody = ref(''),
  remove = ref(false),
  busy = ref(false),
  editDialog = ref<HTMLDialogElement | null>(null)
const viewportHeight = ref('100dvh')
const people = computed(() => chatSummary.value.people)
function person(id: string) {
  return people.value.find((p) => p.id === id)
}
function color(id: string) {
  return profiles.find((p) => p.id === person(id)?.key)?.color ?? 'green'
}
function own(message: ChatMessage) {
  return message.sender_id === identity.value?.profile_id
}
async function bottom() {
  await nextTick()
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  chatAtBottom.value = true
  void markChatRead()
}
function onScroll() {
  const el = scroller.value
  if (!el) return
  chatAtBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  if (chatAtBottom.value) void markChatRead()
}
async function older() {
  const el = scroller.value
  if (!el) return
  const height = el.scrollHeight,
    top = el.scrollTop
  await loadOlder()
  await nextTick()
  el.scrollTop = top + el.scrollHeight - height
}
async function send() {
  const body = draft.value.trim()
  if (!body) return
  draft.value = ''
  error.value = ''
  try {
    await sendMessage(body)
    await bottom()
  } catch (e) {
    draft.value = body
    error.value = e instanceof Error ? e.message : 'Kunde inte skicka.'
  }
}
function keydown(event: KeyboardEvent) {
  if (shouldSend(event, matchMedia('(pointer: coarse)').matches)) {
    event.preventDefault()
    void send()
  }
}
function fit() {
  viewportHeight.value =
    (window.visualViewport?.height ?? window.innerHeight) + 'px'
}
watch(
  () => [messages.value.at(-1)?.id, pendingMessages.value.length],
  () => {
    if (chatAtBottom.value && !opening.value) void bottom()
  },
)
async function edit(message: ChatMessage, deleting = false) {
  editing.value = { ...message }
  editBody.value = message.body
  remove.value = deleting
  error.value = ''
  await nextTick()
  editDialog.value?.showModal()
}
function close() {
  if (!busy.value) editing.value = null
}
async function saveEdit() {
  if (!editing.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await changeMessage(editing.value, editBody.value, remove.value)
    editing.value = null
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Kunde inte ändra.'
  } finally {
    busy.value = false
  }
}
onMounted(async () => {
  fit()
  window.visualViewport?.addEventListener('resize', fit)
  window.addEventListener('resize', fit)
  await openChat()
  opening.value = false
  await bottom()
})
onUnmounted(() => {
  chatActive.value = false
  window.visualViewport?.removeEventListener('resize', fit)
  window.removeEventListener('resize', fit)
})
</script>
<template>
  <section class="chat-view" :style="{ '--chat-viewport': viewportHeight }">
    <header class="chat-heading">
      <div>
        <span class="eyebrow">FÖR OSS TRE</span>
        <h1>Chatt</h1>
        <p>Tobias, Neo och Sally</p>
      </div>
      <span class="small" role="status">{{
        chatStatus === 'loading'
          ? 'Hämtar chatten…'
          : chatStatus === 'unconfigured'
            ? 'Supabase och registrering krävs'
            : chatSync
      }}</span>
    </header>
    <p v-if="chatError" class="notice" role="alert">
      {{ chatError }}
      <button class="secondary-button" @click="refreshChat">Försök igen</button>
    </p>
    <p v-if="error && !editing" role="alert" class="notice">{{ error }}</p>
    <div
      ref="scroller"
      class="chat-timeline"
      role="region"
      aria-label="Meddelandehistorik"
      @scroll="onScroll"
    >
      <button
        v-if="hasOlder"
        class="secondary-button older-messages"
        :disabled="loadingOlder"
        @click="older"
      >
        {{ loadingOlder ? 'Hämtar…' : 'Ladda äldre meddelanden' }}
      </button>
      <p v-if="!messages.length && !opening" class="chat-empty">
        Här börjar familjesnacket. Skriv ett hej 👋
      </p>
      <template v-for="(message, index) in messages" :key="message.id">
        <div
          v-if="
            index === 0 ||
            chatDate(messages[index - 1]!.created_at) !==
              chatDate(message.created_at)
          "
          class="chat-date"
        >
          {{ chatDate(message.created_at) }}
        </div>
        <article
          class="chat-message"
          :class="[color(message.sender_id), { 'is-own': own(message) }]"
          :data-message-id="message.id"
        >
          <div class="chat-bubble">
            <strong class="chat-sender">{{
              person(message.sender_id)?.name ?? 'Familjemedlem'
            }}</strong>
            <p v-if="message.deleted_at" class="deleted-message">
              Meddelandet har raderats
            </p>
            <p v-else class="message-body">
              <template v-for="(part, n) in messageParts(message.body)" :key="n"
                ><a
                  v-if="part.href"
                  :href="part.href"
                  target="_blank"
                  rel="noopener noreferrer"
                  >{{ part.text }}</a
                ><template v-else>{{ part.text }}</template></template
              >
            </p>
            <div class="message-meta">
              <time
                :datetime="message.created_at"
                :title="chatDate(message.created_at)"
                >{{ chatTime(message.created_at) }}</time
              ><span v-if="message.edited_at && !message.deleted_at"
                >Redigerat</span
              ><template v-if="own(message) && !message.deleted_at"
                ><button
                  :aria-label="`Redigera meddelande ${message.seq}`"
                  :disabled="!chatWritable"
                  @click="edit(message)"
                >
                  <Pencil :size="14" /></button
                ><button
                  :aria-label="`Radera meddelande ${message.seq}`"
                  :disabled="!chatWritable"
                  @click="edit(message, true)"
                >
                  <Trash2 :size="14" /></button
              ></template>
            </div>
          </div>
        </article>
      </template>
      <article
        v-for="pending in pendingMessages"
        :key="pending.request"
        class="chat-message is-own pending-message"
      >
        <div class="chat-bubble">
          <p class="message-body">{{ pending.body }}</p>
          <p
            class="small"
            :role="pending.status === 'failed' ? 'alert' : 'status'"
          >
            {{ pending.status === 'sending' ? 'Skickar…' : pending.error }}
          </p>
          <button
            v-if="pending.status === 'failed'"
            class="secondary-button"
            @click="sendMessage(pending.body, pending.request)"
          >
            Försök skicka igen
          </button>
        </div>
      </article>
    </div>
    <button
      v-if="!chatAtBottom"
      class="new-messages secondary-button"
      @click="bottom"
    >
      <ChevronDown :size="17" />Till senaste meddelandet
    </button>
    <form class="chat-composer" @submit.prevent="send">
      <label class="sr-only" for="chat-body">Meddelande</label
      ><textarea
        id="chat-body"
        ref="composer"
        v-model="draft"
        rows="2"
        maxlength="10000"
        placeholder="Skriv till familjen…"
        :disabled="!chatWritable"
        @keydown="keydown"
      ></textarea
      ><button
        class="primary-button"
        aria-label="Skicka meddelande"
        :disabled="!chatWritable || !draft.trim()"
      >
        <Send :size="21" />
      </button>
    </form>
  </section>
  <dialog
    v-if="editing"
    ref="editDialog"
    aria-labelledby="chat-edit-title"
    class="chat-edit-dialog"
    @cancel.prevent="close"
  >
    <div class="dialog-head">
      <h2 id="chat-edit-title">
        {{ remove ? 'Radera meddelande?' : 'Redigera meddelande' }}
      </h2>
      <button aria-label="Stäng" :disabled="busy" @click="close"><X /></button>
    </div>
    <form @submit.prevent="saveEdit">
      <p v-if="remove">Meddelandets text tas bort för alla i familjen.</p>
      <label v-else
        >Ny meddelandetext<textarea
          v-model="editBody"
          rows="4"
          maxlength="10000"
          required
          :disabled="busy"
        ></textarea>
      </label>
      <p v-if="error" class="notice" role="alert">{{ error }}</p>
      <button class="primary-button" :disabled="busy">
        {{ busy ? 'Sparar…' : remove ? 'Ja, radera' : 'Spara ändring' }}
      </button>
    </form>
  </dialog>
</template>
