<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EmptyState from '../components/EmptyState.vue'
const props = defineProps<{ section: string }>()
const route = useRoute()
const router = useRouter()
const tab = computed(() => (route.query.tab === 'inkop' ? 'inkop' : 'todo'))
const text = computed(
  () =>
    ({
      kalender: [
        'Kalender',
        'Plats för allt ni vill hinna med.',
        'Inga aktiviteter att visa',
        'Familjeaktiviteter och skolscheman visas här när säker dataåtkomst har aktiverats.',
      ],
      listor: [
        'Listor',
        'Lite mindre att komma ihåg.',
        tab.value === 'inkop' ? 'Inköpslistan väntar på er' : 'En sak i taget',
        'Gemensamma listor aktiveras i en kommande fas. Inga uppgifter eller inköp har hämtats.',
      ],
      chatt: [
        'Chatt',
        'Nära varandra, även mellan planerna.',
        'Här börjar familjesnacket',
        'Realtidschatten är förberedd i datamodellen. Meddelanden kan ännu inte skickas.',
      ],
      karta: [
        'Karta',
        'En trygg överblick, på era villkor.',
        'Ingen position har hämtats',
        'Platsdelning är inte aktiverad. Här visas senare senast rapporterad position och tidpunkt, aldrig garanterad liveposition.',
      ],
    })[props.section]!,
)
const scope = ref('alla')
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">VÅR GEMENSAMMA VARDAG</span>
      <h1>{{ text[0] }}</h1>
      <p>{{ text[1] }}</p>
    </div>
    <span class="tag">Phase 0 · Förberett</span>
  </div>
  <div v-if="section === 'listor'" class="tabs" aria-label="Välj lista">
    <button :aria-pressed="tab === 'todo'" @click="router.replace('/listor')">
      Att göra</button
    ><button
      :aria-pressed="tab === 'inkop'"
      @click="router.replace('/listor?tab=inkop')"
    >
      Inköp
    </button>
  </div>
  <div v-if="section === 'kalender'" class="calendar-toolbar">
    <h2>Familjekalender</h2>
    <label
      >Visa
      <select v-model="scope">
        <option value="alla">Alla planer</option>
        <option value="skola">Skolscheman</option>
      </select></label
    >
  </div>
  <div class="panel section-panel">
    <EmptyState
      prepared
      :title="
        scope === 'skola' && section === 'kalender'
          ? 'Inget skolschema importerat'
          : text[2]!
      "
      :description="text[3]!"
    />
  </div>
  <p v-if="section === 'karta'" class="small">
    Ingen GPS-behörighet begärs i Phase 0. Framtida platsdelning sker aktivt i
    förgrunden och kan stängas av.
  </p>
  <p v-if="section === 'kalender'" class="small">
    Skolscheman importeras från verifierad JSON. Inga lektionstider är
    förifyllda.
  </p>
</template>
