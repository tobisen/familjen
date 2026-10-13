<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { X } from 'lucide-vue-next'
import {
  parseDraft,
  prepareSchoolImport,
  type SchoolDraft,
} from '../domain/publicSchoolImport'
import {
  importSchool,
  schoolLessons,
  canWrite,
  saving,
} from '../stores/calendar'
import { today } from '../domain/calendar'
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const draft = ref<SchoolDraft | null>(null)
const start = ref(today())
const end = ref('')
const exceptions = ref('')
const confirmed = ref(false)
const error = ref('')
const result = ref('')
onMounted(() => dialog.value?.showModal())
watch([draft, start, end, exceptions], () => {
  confirmed.value = false
  result.value = ''
})
const updateCount = computed(
  () =>
    draft.value?.lessons.filter((l) =>
      schoolLessons.value.some(
        (old) =>
          old.student_id === draft.value?.student_id &&
          old.external_id === l.external_id,
      ),
    ).length ?? 0,
)
function close() {
  if (!saving.value) emit('close')
}
async function readFile(e: Event) {
  error.value = ''
  draft.value = null
  try {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    if (file.size > 2_000_000) throw new Error('Filen är för stor (max 2 MB).')
    draft.value = parseDraft(JSON.parse(await file.text()))
    start.value = draft.value.term_start ?? today()
    end.value = draft.value.term_end ?? ''
    exceptions.value = draft.value.exception_dates.join(', ')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Filen kunde inte läsas.'
  }
}
async function submit() {
  error.value = ''
  result.value = ''
  try {
    if (!draft.value) return
    const rows = prepareSchoolImport(
      draft.value,
      start.value,
      end.value || null,
      exceptions.value.split(/[\s,]+/).filter(Boolean),
      confirmed.value,
    )
    const count = await importSchool(rows)
    result.value = `${count} lektioner importerades eller uppdaterades utan nya dubbletter.`
    confirmed.value = false
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Import misslyckades.'
  }
}
</script>
<template>
  <dialog
    ref="dialog"
    class="import-dialog"
    aria-labelledby="import-title"
    @cancel.prevent="close"
  >
    <div class="dialog-head">
      <h2 id="import-title">Importera skolschema</h2>
      <button aria-label="Stäng" :disabled="saving" @click="close">
        <X />
      </button>
    </div>
    <p class="public-warning">
      Importerade lektioner blir offentliga på internet, inklusive elev, tider,
      ämnen och sal. Alla besökare kan uppdatera dem.
    </p>
    <label
      >JSON-fil<input
        type="file"
        accept="application/json,.json"
        @change="readFile"
    /></label>
    <p class="small">
      Filen läses lokalt för förhandsgranskning. Den skickas först när du väljer
      Importera. Läs formatet i dokumentationen.
    </p>
    <form v-if="draft" @submit.prevent="submit">
      <h3>
        {{ draft.student_id === 'sally' ? 'Sally' : 'Neo' }} ·
        {{ draft.source }}
      </h3>
      <div class="form-row">
        <label>Gäller från<input v-model="start" type="date" required /></label
        ><label
          >Gäller till<input v-model="end" type="date" /><span class="small"
            >Tomt = varje vecka tills manuell uppdatering.</span
          ></label
        >
      </div>
      <label
        >Lov och studiedagar<textarea
          v-model="exceptions"
          placeholder="YYYY-MM-DD, YYYY-MM-DD"
          rows="2"
        ></textarea>
      </label>
      <p class="small">
        {{ draft.lessons.length }} lektioner · {{ updateCount }} uppdateras ·
        {{ draft.lessons.length - updateCount }} skapas. Befintliga lektioner
        som saknas i filen behålls.
      </p>
      <div class="import-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Dag</th>
              <th>Tid</th>
              <th>Ämne</th>
              <th>Sal</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in draft.lessons" :key="l.external_id">
              <td>
                {{
                  ['', 'Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'][
                    l.weekday
                  ]
                }}
              </td>
              <td>{{ l.starts_at ?? 'Okänd' }}–{{ l.ends_at ?? 'Okänd' }}</td>
              <td>{{ l.subject }}</td>
              <td>{{ l.room ?? 'Ej angiven' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!draft.lessons.length" class="notice">
        Inga verifierade lektioner finns i underlaget. Komplettera från källan
        innan import.
      </p>
      <label class="check-label"
        ><input v-model="confirmed" type="checkbox" />Jag har kontrollerat
        tider, giltighet och undantag och bekräftar att schemat får publiceras
        offentligt.</label
      ><button
        class="primary-button"
        :disabled="!confirmed || !canWrite || saving || !draft.lessons.length"
      >
        {{ saving ? 'Importerar…' : 'Importera schema' }}
      </button>
    </form>
    <p v-if="error" role="alert" class="notice">{{ error }}</p>
    <p v-if="result" role="status" class="notice">{{ result }}</p>
    <p v-if="!canWrite" class="small">
      Supabase måste vara konfigurerat och kalendern aktiverad för att spara.
    </p>
  </dialog>
</template>
