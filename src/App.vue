<script setup lang="ts">
import PushStatus from './components/PushStatus.vue'
import { restorePush } from './services/push'
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import ListEditor from './components/ListEditor.vue'
import { chatSummary } from './stores/chat'
import { listEditor, openListEditor, listsWritable } from './stores/lists'
import {
  CalendarDays,
  ListChecks,
  ShoppingBasket,
  MessageCircle,
  Settings,
  Plus,
  X,
} from 'lucide-vue-next'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { selectedProfile, profiles, storageError } from './domain/profiles'
import { editor, detail, openCreate, canWrite } from './stores/calendar'
import { today } from './domain/calendar'
import {
  initializeAuth,
  authStatus,
  identity,
  registration,
} from './stores/auth'
import AuthGate from './components/AuthGate.vue'
import EventEditor from './components/EventEditor.vue'
import EventDetails from './components/EventDetails.vue'
import ProfilePicker from './components/ProfilePicker.vue'
import { backendConfigured } from './services/supabase'
onMounted(() => initializeAuth())
watch(identity, (p) => {
  if (p) void restorePush(p.profile_id).catch(() => {})
})
const nav = [
  { to: '/kalender', label: 'Kalender', icon: CalendarDays },
  { to: '/listor?tab=todo', label: 'Att göra', icon: ListChecks },
  { to: '/listor?tab=inkop', label: 'Inköp', icon: ShoppingBasket },
  { to: '/chatt', label: 'Chatt', icon: MessageCircle },
]
const profile = computed(() =>
  profiles.find(
    (p) => p.id === (identity.value?.profile_key ?? selectedProfile.value),
  ),
)
const route = useRoute()
watch(
  () => route.path,
  () => {
    detail.value = null
    editor.value = null
    listEditor.value = null
  },
  { flush: 'sync' },
)
function focusMain() {
  document.getElementById('main')?.focus()
}
function add() {
  if (route.path === '/listor' && listsWritable.value)
    openListEditor(route.query.tab === 'inkop' ? 'shopping' : 'task')
  else if (route.path === '/kalender' && canWrite.value) openCreate(today())
  else quick.value = true
}
function choose(kind: 'activity' | 'task' | 'shopping') {
  quick.value = false
  if (kind === 'activity') openCreate(today())
  else openListEditor(kind)
}
const quick = ref(false)
const dialog = ref<HTMLDialogElement | null>(null)
const plus = ref<HTMLButtonElement | null>(null)
watch(quick, async (open) => {
  await nextTick()
  if (open) dialog.value?.showModal()
  else {
    dialog.value?.close()
    plus.value?.focus()
  }
})
const online = ref(navigator.onLine)
window.addEventListener('online', () => (online.value = true))
window.addEventListener('offline', () => (online.value = false))
let updateCheck = 0
const { needRefresh, updateServiceWorker } = useRegisterSW({
  onRegisteredSW(_url, registration) {
    const check = () => {
      if (navigator.onLine && Date.now() - updateCheck > 60000) {
        updateCheck = Date.now()
        void registration?.update().catch(() => {})
      }
    }
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
    check()
  },
})
</script>
<template>
  <a class="skip" href="#main" @click.prevent="focusMain">Till innehållet</a>
  <div v-if="needRefresh" class="notice pwa-update" role="status">
    En ny version finns.
    <button @click="updateServiceWorker()">Uppdatera appen</button> Din
    inloggning behålls.
  </div>
  <AuthGate
    v-if="backendConfigured && (authStatus !== 'ready' || registration)"
  />
  <ProfilePicker v-else-if="!selectedProfile && !identity" initial />
  <div v-else class="shell">
    <div class="workspace">
      <header class="topbar">
        <RouterLink to="/" class="mobile-brand"
          >Familjen<span>.</span></RouterLink
        ><span class="desktop-welcome">Vår plats. Våra planer.</span
        ><RouterLink
          to="/installningar"
          class="current-profile"
          aria-label="Inställningar och profil"
          ><span class="avatar small-avatar" :class="profile?.color">{{
            profile?.name[0]
          }}</span
          ><span>{{ profile?.name }}</span
          ><Settings :size="18"
        /></RouterLink>
      </header>
      <nav class="main-tabs" aria-label="Huvudnavigation">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          :class="{
            'active-tab':
              route.path === item.to.split('?')[0] &&
              ((item.label !== 'Att göra' && item.label !== 'Inköp') ||
                (route.query.tab === 'inkop') === (item.label === 'Inköp')),
          }"
        >
          <component :is="item.icon" :size="20" /><span>{{ item.label }}</span>
          <span
            v-if="item.to === '/chatt' && chatSummary.unread"
            class="unread-badge"
            :aria-label="`${chatSummary.unread} olästa meddelanden`"
            >{{ chatSummary.unread > 99 ? '99+' : chatSummary.unread }}</span
          >
        </RouterLink>
      </nav>
      <main id="main" tabindex="-1">
        <p v-if="!online" class="notice" role="status">
          Du är offline. Appens skal fungerar; familjedata synkas inte.
        </p>
        <p v-if="storageError" class="notice" role="alert">
          Profilen kunde inte sparas. Tillåt lokal lagring för att behålla
          valet.
        </p>
        <PushStatus v-if="route.path === '/' && authStatus === 'ready'" />
        <RouterView />
      </main>
    </div>
    <button ref="plus" class="quick-add" aria-label="Lägg till" @click="add">
      <Plus :size="24" /><span>Lägg till</span>
    </button>
    <dialog
      ref="dialog"
      aria-labelledby="quick-title"
      @cancel.prevent="quick = false"
      @click="
        (e) => {
          if (e.target === dialog) quick = false
        }
      "
    >
      <div class="dialog-head">
        <h2 id="quick-title">Vad vill du lägga till?</h2>
        <button aria-label="Stäng" @click="quick = false"><X /></button>
      </div>
      <p>Vad vill du komma ihåg?</p>
      <div class="quick-options">
        <button
          class="secondary-button"
          :disabled="!canWrite"
          @click="choose('activity')"
        >
          <Plus :size="20" />Aktivitet
        </button>
        <button
          class="secondary-button"
          :disabled="!listsWritable"
          @click="choose('task')"
        >
          <Plus :size="20" />Uppgift
        </button>
        <button
          class="secondary-button"
          :disabled="!listsWritable"
          @click="choose('shopping')"
        >
          <Plus :size="20" />Inköp
        </button>
      </div>
      <p v-if="!canWrite && !listsWritable" class="small">
        Supabase och en registrerad enhet krävs. Ingenting sparas ännu.
      </p>
      <RouterLink to="/kalender" class="text-link" @click="quick = false"
        >Visa kalendern</RouterLink
      >
    </dialog>
    <EventEditor
      v-if="editor"
      :key="`${editor.id}:${editor.date}:${editor.time}`"
    />
    <EventDetails v-if="detail" :key="detail.key" />
    <ListEditor v-if="listEditor" :key="listEditor.request" />
  </div>
</template>
