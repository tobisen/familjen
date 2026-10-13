<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import {
  ArrowRight,
  CalendarDays,
  ListChecks,
  ShoppingBasket,
  MessageCircle,
  Sun,
} from 'lucide-vue-next'
import { profiles, selectedProfile } from '../domain/profiles'
import CalendarEvent from '../components/CalendarEvent.vue'
import { occurrences, today, addDays } from '../domain/calendar'
import { activities, schoolLessons, calendarStatus } from '../stores/calendar'
import EmptyState from '../components/EmptyState.vue'
import {
  tasks,
  remainingShopping,
  listsStatus,
  listPeople,
} from '../stores/lists'
import { filterTasks, taskTiming } from '../domain/lists'
import { identity } from '../stores/auth'
const currentTasks = computed(() =>
  filterTasks(tasks.value, 'active', identity.value?.profile_key ?? null).slice(
    0,
    5,
  ),
)
const upcoming = computed(() =>
  occurrences(
    activities.value,
    schoolLessons.value,
    today(),
    addDays(today(), 31),
  )
    .filter((o) => Date.parse(o.ends_at) > Date.now())
    .slice(0, 5),
)
const name = computed(
  () => profiles.find((p) => p.id === selectedProfile.value)?.name,
)
const date = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
}).format(new Date())
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">{{ date }}</span>
      <h1>Hej {{ name }}<span class="wave">☀</span></h1>
      <p>Här samlar vi allt som gör vardagen lite enklare.</p>
    </div>
    <span class="tag phase-tag">Vår gemensamma plats</span>
  </div>
  <section class="welcome-card">
    <div>
      <span class="eyebrow">HEMMA I VARDAGEN</span>
      <h2>Små planer.<br />Mer tid tillsammans.</h2>
      <p>
        En plats för familjens planer, listor<br class="desktop-break" />
        och allt däremellan.
      </p>
      <RouterLink to="/kalender"
        >Till familjekalendern <ArrowRight :size="18"
      /></RouterLink>
    </div>
    <div class="home-art" aria-hidden="true">
      <Sun class="art-sun" :size="43" />
      <div class="house-roof"></div>
      <div class="house-body">
        <div class="house-window"></div>
        <div class="house-door"></div>
      </div>
      <div class="art-tree"></div>
      <div class="art-ground"></div>
      <span class="art-caption">tillsammans är hemma</span>
    </div>
  </section>
  <div class="section-title">
    <h2>Vardagen i överblick</h2>
    <span>Allt på sin plats</span>
  </div>
  <section class="overview">
    <RouterLink
      v-for="item in [
        {
          title: 'Kalender',
          text: 'Familjens planer & skolscheman',
          to: '/kalender',
          icon: CalendarDays,
          color: 'sage',
        },
        {
          title: 'Att göra',
          text: 'Små och stora saker att fixa',
          to: '/listor',
          icon: ListChecks,
          color: 'blue',
        },
        {
          title: 'Inköp',
          text:
            listsStatus === 'ready'
              ? `${remainingShopping} varor kvar att köpa`
              : 'Kom ihåg det som saknas hemma',
          to: '/listor?tab=inkop',
          icon: ShoppingBasket,
          color: 'peach',
        },
      ]"
      :key="item.title"
      :to="item.to"
      class="overview-card"
      ><span class="tile-icon" :class="item.color"
        ><component :is="item.icon" :size="23"
      /></span>
      <h3>{{ item.title }}</h3>
      <p>{{ item.text }}</p>
      <span class="card-link"
        >{{
          item.title === 'Kalender'
            ? 'Öppna kalendern'
            : item.title === 'Att göra'
              ? 'Visa uppgifter'
              : 'Öppna inköpslistan'
        }}
        <ArrowRight :size="16" /></span
    ></RouterLink>
  </section>
  <section class="panel home-tasks">
    <div class="panel-title">
      <h2>Att göra just nu</h2>
      <RouterLink to="/listor"
        >Alla uppgifter <ArrowRight :size="16"
      /></RouterLink>
    </div>
    <RouterLink
      v-for="task in currentTasks"
      :key="task.id"
      to="/listor"
      class="home-task-row"
      ><strong>{{ task.title }}</strong
      ><span :class="{ overdue: taskTiming(task, today()) === 'Förfallen' }"
        >{{ taskTiming(task, today())
        }}{{ task.deadline ? ` · ${task.deadline}` : '' }}</span
      ><span class="small">{{
        task.assigned_ids
          .map((id) => listPeople.find((p) => p.key === id)?.name)
          .join(', ') || 'Ingen tilldelad'
      }}</span></RouterLink
    >
    <p v-if="!currentTasks.length" class="small">
      {{
        listsStatus === 'ready'
          ? 'Inga aktiva uppgifter. Lägg till det ni vill få gjort.'
          : listsStatus === 'loading'
            ? 'Hämtar uppgifter…'
            : 'Uppgifter visas när listans anslutning är klar.'
      }}
    </p>
  </section>
  <section class="home-grid">
    <div class="panel">
      <div class="panel-title">
        <h2>På gång</h2>
        <RouterLink to="/kalender"
          >Kalender <ArrowRight :size="16"
        /></RouterLink>
      </div>
      <div v-if="upcoming.length" class="upcoming-events">
        <div v-for="o in upcoming" :key="o.key">
          <span class="small">{{ o.date }}</span
          ><CalendarEvent :occurrence="o" />
        </div>
      </div>
      <EmptyState
        v-else
        title="Plats för era planer"
        :description="
          calendarStatus === 'ready'
            ? 'Inga kommande aktiviteter de närmaste 30 dagarna.'
            : 'Kommande aktiviteter visas när Supabase har konfigurerats och kalendern aktiverats.'
        "
      />
    </div>
    <div class="panel chat-panel">
      <div class="panel-title">
        <h2>Familjesnack</h2>
        <MessageCircle :size="21" />
      </div>
      <div class="family-bubbles">
        <span
          v-for="p in profiles"
          :key="p.id"
          class="avatar"
          :class="p.color"
          >{{ p.name[0] }}</span
        >
      </div>
      <h3>En tråd för oss tre.</h3>
      <p>
        Snabba frågor, små påminnelser och ett hej. Familjechatten kommer i en
        senare fas.
      </p>
      <RouterLink to="/chatt" class="text-link"
        >Till chatten <ArrowRight :size="17"
      /></RouterLink>
    </div>
  </section>
</template>
