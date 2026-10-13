<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import {
  House,
  CalendarDays,
  ListChecks,
  MessageCircle,
  MapPin,
  Settings,
  Plus,
  X,
  ArrowUpRight,
} from 'lucide-vue-next'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { selectedProfile, profiles, storageError } from './domain/profiles'
import {
  startCalendar,
  editor,
  detail,
  openCreate,
  canWrite,
  calendarStatus,
} from './stores/calendar'
import { today } from './domain/calendar'
import EventEditor from './components/EventEditor.vue'
import EventDetails from './components/EventDetails.vue'
import ProfilePicker from './components/ProfilePicker.vue'
import { backendConfigured } from './services/supabase'
onMounted(() => startCalendar())
const nav = [
  { to: '/', label: 'Hem', icon: House },
  { to: '/kalender', label: 'Kalender', icon: CalendarDays },
  { to: '/listor', label: 'Listor', icon: ListChecks },
  { to: '/chatt', label: 'Chatt', icon: MessageCircle },
  { to: '/karta', label: 'Karta', icon: MapPin },
]
const profile = computed(() =>
  profiles.find((p) => p.id === selectedProfile.value),
)
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
const { needRefresh, updateServiceWorker } = useRegisterSW()
</script>
<template>
  <a class="skip" href="#main">Till innehållet</a>
  <ProfilePicker v-if="!selectedProfile" initial />
  <div v-else class="shell">
    <aside class="sidebar">
      <RouterLink to="/" class="brand"
        ><span class="brand-mark"><House :size="23" /></span>Familjen<span
          class="brand-dot"
          >.</span
        ></RouterLink
      ><span class="eyebrow sidebar-label">VÅR VARDAG, TILLSAMMANS</span>
      <nav aria-label="Huvudnavigation">
        <RouterLink v-for="item in nav" :key="item.to" :to="item.to"
          ><component :is="item.icon" :size="21" />{{ item.label }}</RouterLink
        >
      </nav>
      <div class="sidebar-bottom">
        <div class="family-mini">
          <span
            v-for="p in profiles"
            :key="p.id"
            class="avatar"
            :class="p.color"
            >{{ p.name[0] }}</span
          >
        </div>
        <p>En liten plats för oss.</p>
        <RouterLink to="/installningar"
          ><Settings :size="19" />Inställningar</RouterLink
        >
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <RouterLink to="/" class="mobile-brand"
          >Familjen<span>.</span></RouterLink
        ><span class="desktop-welcome"
          >Lite mer tillsammans. Lite mindre att hålla i huvudet.</span
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
      <main id="main">
        <p v-if="!online" class="notice" role="status">
          Du är offline. Appens skal fungerar; familjedata synkas inte.
        </p>
        <p v-if="storageError" class="notice" role="alert">
          Profilen kunde inte sparas. Tillåt lokal lagring för att behålla
          valet.
        </p>
        <div v-if="needRefresh" class="notice">
          En ny version finns.
          <button @click="updateServiceWorker()">Uppdatera appen</button>
        </div>
        <RouterView />
        <div class="setup-notice">
          <span class="status-dot"></span>
          <div>
            <strong>{{
              backendConfigured
                ? calendarStatus === 'ready'
                  ? 'Offentlig familjekalender'
                  : 'Kalenderanslutning återstår'
                : 'En bra början. Snart fyller vi den med er vardag.'
            }}</strong>
            <p>
              {{
                backendConfigured
                  ? 'Kalendern är offentlig för läsning och redigering. Chatt, GPS och push är fortsatt skyddade och inaktiva.'
                  : 'Supabase är inte konfigurerat. Familjedata och synkning aktiveras efter säker installation.'
              }}
            </p>
          </div>
          <RouterLink to="/installningar" aria-label="Visa konfiguration"
            ><ArrowUpRight :size="22"
          /></RouterLink>
        </div>
        <footer>FAMILJEN <span>Byggd för vår vardag · Phase 1</span></footer>
      </main>
    </div>
    <button
      ref="plus"
      class="quick-add"
      aria-label="Lägg till"
      @click="canWrite ? openCreate(today()) : (quick = true)"
    >
      <Plus :size="24" /><span>Lägg till</span>
    </button>
    <nav class="bottom-nav" aria-label="Mobilnavigation">
      <RouterLink v-for="item in nav" :key="item.to" :to="item.to"
        ><component :is="item.icon" :size="22" /><span>{{
          item.label
        }}</span></RouterLink
      >
    </nav>
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
      <p>
        Aktiviteter kan sparas när Supabase är konfigurerat och den offentliga
        kalendern är aktiverad. Uppgifter och inköp kommer i Phase 2.
      </p>
      <div class="quick-options">
        <div v-for="label in ['Aktivitet', 'Uppgift', 'Inköp']" :key="label">
          <Plus :size="20" /><strong>{{ label }}</strong
          ><span class="tag">Kommer snart</span>
        </div>
      </div>
      <p class="small">Ingenting sparas ännu.</p>
      <RouterLink to="/kalender" class="text-link" @click="quick = false"
        >Visa kalendern</RouterLink
      >
    </dialog>
    <EventEditor
      v-if="editor"
      :key="`${editor.id}:${editor.date}:${editor.time}`"
    />
    <EventDetails v-if="detail" :key="detail.key" />
  </div>
</template>
