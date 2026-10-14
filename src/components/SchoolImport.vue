<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { X } from 'lucide-vue-next'
import {
  parseDraft,
  lessonIssues,
  exceptionRange,
  prepareSchoolImport,
  type SchoolDraft,
} from '../domain/publicSchoolImport'
import { schoolLessons, canWrite, saving } from '../stores/calendar'
import {
  loadSchoolRecords,
  saveSchoolRecord,
  type SchoolRecord,
} from '../data/schoolRepository'
import { reloadCalendar } from '../stores/calendar'
const records = ref<SchoolRecord[]>([])
const selected = ref('')
const editBase = ref<{
  student: string
  period: string
  version: number
} | null>(null)
const busy = ref(false)
const replace = ref(false)
const loading = ref(false)
const holidayStart = ref('')
const holidayEnd = ref('')
function addHoliday() {
  try {
    exceptions.value = [
      ...new Set([
        ...exceptions.value.split(/[\s,]+/).filter(Boolean),
        ...exceptionRange(holidayStart.value, holidayEnd.value),
      ]),
    ]
      .sort()
      .join(', ')
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ogiltig ledighet.'
  }
}
async function load(refreshCurrent = false) {
  loading.value = true
  try {
    records.value = await loadSchoolRecords()
    if (refreshCurrent) choose()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Scheman kunde inte hämtas.'
  } finally {
    loading.value = false
  }
}
function choose() {
  const r = records.value.find((r) => r.id === selected.value)
  if (!r) return
  editBase.value = {
    student: r.student_id,
    period: r.period_key,
    version: r.version,
  }
  draft.value = parseDraft(JSON.parse(JSON.stringify(r.draft)))
  start.value = r.draft.term_start ?? ''
  end.value = r.draft.term_end ?? ''
  exceptions.value = r.draft.exception_dates.join(', ')
  error.value = ''
  result.value = ''
}
const eligible = computed(
  () => draft.value?.lessons.filter((l) => !lessonIssues(l).length).length ?? 0,
)
const newLessonId = () => crypto.randomUUID()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const draft = ref<SchoolDraft | null>(null)
const start = ref('')
const end = ref('')
const exceptions = ref('')
const confirmed = ref(false)
const error = ref('')
const result = ref('')
onMounted(() => {
  dialog.value?.showModal()
  if (canWrite.value) void load()
})
watch(
  [draft, start, end, exceptions],
  () => {
    confirmed.value = false
    result.value = ''
  },
  { deep: true },
)
const updateCount = computed(
  () =>
    draft.value?.lessons
      .filter((l) => !lessonIssues(l).length)
      .filter((l) =>
        schoolLessons.value.some(
          (old) =>
            old.student_id === draft.value?.student_id &&
            (old.external_id === l.external_id ||
              old.external_id ===
                `period:${draft.value?.period_key}:${l.external_id}`),
        ),
      ).length ?? 0,
)
function close() {
  if (!saving.value && !busy.value) emit('close')
}
async function readFile(e: Event) {
  error.value = ''
  draft.value = null
  try {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    if (file.size > 2_000_000) throw new Error('Filen är för stor (max 2 MB).')
    draft.value = parseDraft(JSON.parse(await file.text()))
    draft.value.period_key ??= `term-${draft.value.term_start ?? 'utkast'}`
    selected.value = ''
    const existing = records.value.find(
      (r) =>
        r.student_id === draft.value?.student_id &&
        r.period_key === draft.value?.period_key,
    )
    editBase.value = existing
      ? {
          student: existing.student_id,
          period: existing.period_key,
          version: existing.version,
        }
      : null
    start.value = draft.value.term_start ?? ''
    end.value = draft.value.term_end ?? ''
    exceptions.value = draft.value.exception_dates.join(', ')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Filen kunde inte läsas.'
  }
}
async function persist(activate: boolean) {
  if (!draft.value) return
  error.value = ''
  result.value = ''
  busy.value = true
  try {
    const payload = parseDraft({
      ...draft.value,
      term_start: start.value || null,
      term_end: end.value || null,
      exception_dates: exceptions.value.split(/[\s,]+/).filter(Boolean),
    })
    if (!payload.period_key) throw new Error('Ange ett period-ID först.')
    if (activate)
      prepareSchoolImport(
        payload,
        start.value,
        end.value || null,
        payload.exception_dates,
        confirmed.value,
      )
    const previous = records.value.find(
      (r) =>
        r.student_id === payload.student_id &&
        r.period_key === payload.period_key,
    )
    const sameBase =
      editBase.value?.student === payload.student_id &&
      editBase.value?.period === payload.period_key
    if (previous && !sameBase)
      throw new Error(
        'Period-ID finns redan. Välj det sparade schemat innan du ändrar det.',
      )
    const saved = await saveSchoolRecord(
      payload,
      sameBase ? editBase.value!.version : null,
      activate,
      replace.value,
    )
    await reloadCalendar()
    await load()
    selected.value = saved.record.id
    editBase.value = {
      student: saved.record.student_id,
      period: saved.record.period_key,
      version: saved.record.version,
    }
    confirmed.value = false
    result.value = activate
      ? `${saved.count} lektioner importerades eller uppdaterades utan nya dubbletter. ${draft.value.lessons.length - saved.count} ofullständiga poster väntar.`
      : 'Utkast sparat privat. Kalendern ändrades inte.'
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Schemat kunde inte sparas.'
  } finally {
    busy.value = false
  }
}
async function submit() {
  await persist(true)
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
      <button aria-label="Stäng" :disabled="saving || busy" @click="close">
        <X />
      </button>
    </div>
    <p class="public-warning">
      Schemat delas endast med registrerade familjemedlemmar. Bekräftade
      terminsdatum krävs före import.
    </p>
    <p v-if="loading" role="status">Hämtar familjens scheman…</p>
    <label
      >Familjens sparade scheman<select
        v-model="selected"
        :disabled="busy"
        @change="choose"
      >
        <option value="">Välj schema eller ladda upp JSON</option>
        <option v-for="r in records" :key="r.id" :value="r.id">
          {{ r.student_id === 'sally' ? 'Sally' : 'Neo' }} ·
          {{ r.period_key }} · {{ r.active_ids.length }} aktiverade
        </option>
      </select></label
    >
    <button
      type="button"
      class="secondary-button"
      :disabled="loading || busy"
      @click="load(true)"
    >
      Hämta senaste och återställ förhandsgranskningen
    </button>
    <label
      >JSON-fil<input
        type="file"
        accept="application/json,.json"
        :disabled="busy"
        @change="readFile"
    /></label>
    <p class="small">
      Filen läses lokalt för förhandsgranskning. Den skickas först när du väljer
      Spara utkast eller Importera. Läs formatet i dokumentationen.
    </p>
    <form v-if="draft" @submit.prevent="submit">
      <fieldset class="school-form" :disabled="busy">
        <h3>
          {{ draft.student_id === 'sally' ? 'Sally' : 'Neo' }} ·
          {{ draft.source }}
        </h3>
        <p v-if="draft.notes" class="notice">{{ draft.notes }}</p>
        <details>
          <summary>Källor och anteckningar</summary>
          <label
            >Schemakälla<input
              v-model="draft.source"
              required
              maxlength="1000" /></label
          ><label>Datumkälla<input v-model="draft.date_source" /></label
          ><label
            >Anteckningar<textarea v-model="draft.notes" rows="3"></textarea>
          </label>
        </details>
        <p v-if="draft.date_source" class="small">
          Datumkälla: {{ draft.date_source }}
        </p>
        <label
          >Period-ID<input
            v-model="draft.period_key"
            placeholder="exempel: ht2026"
            pattern="[a-zA-Z0-9_-]{1,60}"
          /><span class="small"
            >Behåll samma ID vid uppdatering. Använd nytt ID för nästa
            termin.</span
          ></label
        >
        <div class="form-row">
          <label
            >Gäller från<input v-model="start" type="date" required /></label
          ><label
            >Gäller till<input v-model="end" type="date" required /><span
              class="small"
              >Bekräftat terminsslut krävs.</span
            ></label
          >
        </div>
        <p v-if="!start || !end" class="notice">
          Komplettera bekräftad terminsstart och terminsslut innan aktivering.
        </p>
        <label
          >Lov, studiedagar och enskilda avvikelser<textarea
            v-model="exceptions"
            placeholder="YYYY-MM-DD, YYYY-MM-DD"
            rows="2"
          ></textarea>
        </label>
        <div class="form-row">
          <label>Ledig från<input v-model="holidayStart" type="date" /></label
          ><label>Ledig till<input v-model="holidayEnd" type="date" /></label>
        </div>
        <button type="button" class="secondary-button" @click="addHoliday">
          Lägg till lov eller studiedag
        </button>
        <p class="small">
          {{ eligible }} aktiverbara lektioner · {{ updateCount }} uppdateras ·
          {{ eligible - updateCount }} skapas. Befintliga lektioner som saknas i
          filen behålls.
        </p>
        <p class="notice">
          {{ eligible }} av {{ draft.lessons.length }} poster kan aktiveras.
          Övriga sparas som utkast. Okända sluttider uppskattas aldrig.
        </p>
        <div class="lesson-editors">
          <details v-for="(l, i) in draft.lessons" :key="l.external_id">
            <summary>
              {{
                ['', 'Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'][l.weekday]
              }}
              {{ l.starts_at ?? 'Okänd start' }}–{{
                l.ends_at ?? 'Okänt slut'
              }}
              · {{ l.subject }} ·
              {{ lessonIssues(l).join(' · ') || 'Komplett' }}
            </summary>
            <p v-if="l.uncertainty" class="notice">
              Källans osäkerhet: {{ l.uncertainty }}
            </p>
            <label
              >Ämne {{ i + 1
              }}<input v-model="l.subject" maxlength="200" required
            /></label>
            <label
              >Veckodag {{ i + 1
              }}<select v-model.number="l.weekday">
                <option
                  v-for="(day, index) in [
                    'Mån',
                    'Tis',
                    'Ons',
                    'Tor',
                    'Fre',
                    'Lör',
                    'Sön',
                  ]"
                  :key="index"
                  :value="index + 1"
                >
                  {{ day }}
                </option>
              </select></label
            >
            <div class="form-row">
              <label
                >Starttid {{ i + 1
                }}<input
                  type="time"
                  :value="l.starts_at ?? ''"
                  @input="
                    l.starts_at =
                      ($event.target as HTMLInputElement).value || null
                  " /></label
              ><label
                >Sluttid {{ i + 1
                }}<input
                  type="time"
                  :value="l.ends_at ?? ''"
                  @input="
                    l.ends_at =
                      ($event.target as HTMLInputElement).value || null
                  "
              /></label>
            </div>
            <label
              >Undantagsdatum för lektion {{ i + 1
              }}<input
                :value="(l.exception_dates ?? []).join(', ')"
                placeholder="YYYY-MM-DD, YYYY-MM-DD"
                @change="
                  l.exception_dates = ($event.target as HTMLInputElement).value
                    .split(/[\s,]+/)
                    .filter(Boolean)
                "
            /></label>
            <label
              >Sal {{ i + 1 }}<input v-model="l.room" maxlength="200"
            /></label>
            <label class="check-label"
              ><input
                type="checkbox"
                :checked="l.confirmed !== false"
                @change="
                  l.confirmed = ($event.target as HTMLInputElement).checked
                "
              />Lektion {{ i + 1 }} verifierad mot källa</label
            >
            <button
              type="button"
              class="secondary-button"
              @click="draft.lessons.splice(i, 1)"
            >
              Ta bort denna schemapost ur utkastet
            </button>
          </details>
        </div>
        <button
          type="button"
          class="secondary-button"
          @click="
            draft.lessons.push({
              external_id: newLessonId(),
              weekday: 1,
              starts_at: null,
              ends_at: null,
              subject: '',
              room: null,
              confirmed: false,
            })
          "
        >
          Lägg till schemapost
        </button>
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
        <label v-if="draft.period_key" class="check-label"
          ><input v-model="replace" type="checkbox" />Ersätt periodens tidigare
          aktiverade schemaposter som saknas eller inte längre är bekräftade.
          Privata aktiviteter påverkas inte.</label
        >
        <button
          type="button"
          class="secondary-button"
          :disabled="!canWrite || busy || saving"
          @click="persist(false)"
        >
          {{ busy ? 'Sparar…' : 'Spara utkast' }}
        </button>
        <label class="check-label"
          ><input v-model="confirmed" type="checkbox" />Jag har kontrollerat de
          verifierade lektionernas tider, terminsstart, terminsslut och undantag
          och bekräftar att uppgifterna ska delas med familjen.</label
        ><button
          class="primary-button"
          :disabled="
            !confirmed ||
            !canWrite ||
            saving ||
            busy ||
            !eligible ||
            !start ||
            !end
          "
        >
          {{ saving || busy ? 'Importerar…' : 'Importera schema' }}
        </button>
      </fieldset>
    </form>
    <p v-if="error" role="alert" class="notice">{{ error }}</p>
    <p v-if="result" role="status" class="notice">{{ result }}</p>
    <p v-if="!canWrite" class="small">
      Supabase måste vara konfigurerat och kalendern aktiverad för att spara.
    </p>
  </dialog>
</template>

<style scoped>
.school-form {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.lesson-editors details {
  border-bottom: 1px solid var(--line, #ddd);
  padding: 0.8rem 0;
}
.lesson-editors summary {
  cursor: pointer;
  line-height: 1.6;
}
</style>
