<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import {
  ChevronLeft,
  ChevronRight,
  Upload,
  X,
  LockKeyhole,
} from 'lucide-vue-next'
import PersonalWeekPlan from '../components/PersonalWeekPlan.vue'
import {
  isoWeek,
  weekDates,
  shiftWeek,
  parsePersonalWeek,
  validatePersonalPlan,
  weekTypes,
  categories,
  categoryLabels,
  taskCategories,
  taskCategoryLabels,
  summaryLabels,
  priorityLabels,
  type PersonalPlan,
  type SavedPersonalWeek,
} from '../domain/personalWeek'
import {
  loadPersonalWeek,
  savePersonalWeek,
} from '../data/personalWeekRepository'
import { identity } from '../stores/auth'
const route = useRoute(),
  router = useRouter()
const selected = computed(() => {
  const year = Number(route.query.year),
    week_number = Number(route.query.week)
  try {
    if (
      !Number.isInteger(year) ||
      year < 2000 ||
      year > 2100 ||
      !Number.isInteger(week_number) ||
      week_number < 1 ||
      week_number > 53
    )
      return isoWeek()
    weekDates(year, week_number)
    return { year, week_number }
  } catch {
    return isoWeek()
  }
})
const dates = computed(() =>
  weekDates(selected.value.year, selected.value.week_number),
)
const plan = ref<SavedPersonalWeek | null>(null)
const loading = ref(false),
  saving = ref(false),
  error = ref(''),
  status = ref('')
let loadGeneration = 0
const authorizedProfile = identity.value?.profile_id
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
async function load() {
  const generation = ++loadGeneration
  plan.value = null
  loading.value = true
  error.value = ''
  status.value = ''
  try {
    const result = await loadPersonalWeek(
      selected.value.year,
      selected.value.week_number,
    )
    if (generation === loadGeneration) plan.value = result
  } catch (e) {
    if (generation === loadGeneration) error.value = message(e)
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}
function message(e: unknown) {
  return e instanceof Error
    ? e.message
    : 'Kunde inte spara. Kontrollera anslutningen och försök igen.'
}
watch(selected, load, { immediate: true })
watch(identity, (p) => {
  if (p?.profile_id !== authorizedProfile) {
    ++loadGeneration
    plan.value = null
    draft.value = null
    preview.value = null
    void router.replace('/kalender')
  }
})
function navigate(step: number) {
  const next = shiftWeek(selected.value.year, selected.value.week_number, step)
  if (next.year < 2000 || next.year > 2100) return
  void router.push({
    path: '/min-vecka',
    query: { year: next.year, week: next.week_number },
  })
}
const importDialog = ref<HTMLDialogElement | null>(null),
  editDialog = ref<HTMLDialogElement | null>(null)
const raw = ref(''),
  preview = ref<PersonalPlan | null>(null),
  existing = ref<SavedPersonalWeek | null>(null),
  replace = ref(false),
  importError = ref('')
let importRequest = crypto.randomUUID()
function resetImport() {
  raw.value = ''
  preview.value = null
  existing.value = null
  replace.value = false
  importError.value = ''
}
function closeImport() {
  resetImport()
  importDialog.value?.close()
}
function cancelImport(event: Event) {
  if (saving.value) event.preventDefault()
  else resetImport()
}
function openImport() {
  raw.value = ''
  preview.value = null
  existing.value = null
  replace.value = false
  importError.value = ''
  importDialog.value?.showModal()
}
function editImport() {
  preview.value = null
  importError.value = ''
}
async function inspect() {
  importError.value = ''
  preview.value = null
  existing.value = null
  replace.value = false
  saving.value = true
  try {
    const parsed = parsePersonalWeek(raw.value)
    const current = await loadPersonalWeek(parsed.year, parsed.week_number)
    preview.value = parsed
    existing.value = current
    importRequest = crypto.randomUUID()
  } catch (e) {
    importError.value = message(e)
  } finally {
    saving.value = false
  }
}
async function importWeek() {
  if (!preview.value || (existing.value && !replace.value)) return
  saving.value = true
  importError.value = ''
  try {
    const saved = await savePersonalWeek(
      preview.value,
      existing.value?.version ?? null,
      importRequest,
    )
    closeImport()
    await router.replace({
      path: '/min-vecka',
      query: { year: saved.year, week: saved.week_number },
    })
    ++loadGeneration
    plan.value = saved
    loading.value = false
    error.value = ''
    status.value = 'Veckan importerades.'
  } catch (e) {
    importError.value = message(e)
  } finally {
    saving.value = false
  }
}
type EditKind = 'item' | 'day' | 'task' | 'focus' | 'summary'
const kind = ref<EditKind>('item'),
  draft = ref<SavedPersonalWeek | null>(null),
  dayIndex = ref(0),
  itemIndex = ref(0),
  focusText = ref(''),
  editError = ref(''),
  deleting = ref(false)
const editedDay = computed(() => draft.value?.days[dayIndex.value])
const editedItem = computed(() => editedDay.value?.items[itemIndex.value])
const editedTask = computed(() => draft.value?.tasks[itemIndex.value])
const editorTitle = computed(
  () =>
    ({
      item: 'Dagspost',
      day: 'Dagens prioritet',
      task: 'Veckouppgift',
      focus: 'Veckans fokus',
      summary: 'Veckosammanfattning',
    })[kind.value],
)
let editRequest = '',
  lastEditPayload = ''
async function openEdit(type: EditKind, day = 0, index?: number) {
  if (!plan.value || saving.value) return
  draft.value = clone(plan.value)
  kind.value = type
  dayIndex.value = day
  itemIndex.value = index ?? 0
  deleting.value = false
  editError.value = ''
  focusText.value = draft.value.focus.join('\n')
  lastEditPayload = ''
  if (type === 'item' && index === undefined) {
    itemIndex.value = draft.value.days[day]!.items.length
    draft.value.days[day]!.items.push({
      category: 'other',
      content: '',
      done: false,
    })
  }
  if (type === 'task' && index === undefined) {
    itemIndex.value = draft.value.tasks.length
    draft.value.tasks.push({ category: 'other', task: '', done: false })
  }
  await nextTick()
  editDialog.value?.showModal()
}
async function persist(candidate: SavedPersonalWeek, requestId: string) {
  validatePersonalPlan(candidate)
  return savePersonalWeek(candidate, candidate.version, requestId)
}
async function saveEdit(remove = false) {
  if (!draft.value) return
  editError.value = ''
  saving.value = true
  const candidate = clone(draft.value)
  if (remove && kind.value === 'item')
    candidate.days[dayIndex.value]!.items.splice(itemIndex.value, 1)
  if (remove && kind.value === 'task')
    candidate.tasks.splice(itemIndex.value, 1)
  if (kind.value === 'focus')
    candidate.focus = focusText.value
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean)
  const serialized = JSON.stringify(candidate)
  if (serialized !== lastEditPayload) {
    editRequest = crypto.randomUUID()
    lastEditPayload = serialized
  }
  try {
    plan.value = await persist(candidate, editRequest)
    editDialog.value?.close()
    draft.value = null
    status.value = 'Ändringen sparades.'
  } catch (e) {
    editError.value = message(e)
  } finally {
    saving.value = false
  }
}
async function change(candidate: SavedPersonalWeek) {
  const previous = plan.value
  plan.value = candidate
  saving.value = true
  error.value = ''
  status.value = ''
  try {
    plan.value = await persist(candidate, crypto.randomUUID())
    status.value = 'Ändringen sparades.'
  } catch (e) {
    plan.value = previous
    error.value = message(e)
  } finally {
    saving.value = false
  }
}
function toggle(type: 'item' | 'task', day: number, index: number) {
  if (!plan.value || saving.value) return
  const candidate = clone(plan.value)
  const entry =
    type === 'item'
      ? candidate.days[day]!.items[index]!
      : candidate.tasks[index]!
  entry.done = !entry.done
  void change(candidate)
}
function move(day: number, index: number, step: number) {
  if (!plan.value || saving.value) return
  const candidate = clone(plan.value),
    items = candidate.days[day]!.items
  const entry = items.splice(index, 1)[0]!
  items.splice(index + step, 0, entry)
  void change(candidate)
}
function refresh() {
  if (
    !saving.value &&
    !importDialog.value?.open &&
    !editDialog.value?.open &&
    document.visibilityState === 'visible'
  )
    void load()
}
onMounted(() => window.addEventListener('focus', refresh))
onBeforeUnmount(() => {
  ++loadGeneration
  window.removeEventListener('focus', refresh)
})
onBeforeRouteLeave(() => !saving.value)
</script>
<template>
  <section class="personal-week" aria-labelledby="personal-title">
    <div class="personal-heading">
      <div>
        <p class="eyebrow"><LockKeyhole :size="12" /> Bara för dig</p>
        <h1 id="personal-title">Min vecka</h1>
      </div>
      <button class="primary-button" :disabled="saving" @click="openImport">
        <Upload :size="17" /> Importera vecka
      </button>
    </div>
    <div class="personal-week-nav">
      <button
        aria-label="Föregående vecka"
        :disabled="
          saving || (selected.year === 2000 && selected.week_number === 1)
        "
        @click="navigate(-1)"
      >
        <ChevronLeft />
      </button>
      <div>
        <h2>Vecka {{ selected.week_number }} · {{ selected.year }}</h2>
        <p>{{ dates[0] }} – {{ dates[6] }}</p>
      </div>
      <button
        aria-label="Nästa vecka"
        :disabled="
          saving || (selected.year === 2100 && selected.week_number === 52)
        "
        @click="navigate(1)"
      >
        <ChevronRight />
      </button>
    </div>
    <p v-if="loading" role="status">Hämtar din vecka…</p>
    <p v-if="saving" role="status">Sparar…</p>
    <p v-if="status" role="status" class="small">{{ status }}</p>
    <div v-if="error" class="notice" role="alert">
      {{ error }}
      <button class="text-link" :disabled="saving" @click="load">
        Hämta senaste veckan
      </button>
    </div>
    <template v-if="plan"
      ><p class="personal-week-type">{{ weekTypes[plan.week_type] }}</p>
      <PersonalWeekPlan
        :plan="plan"
        editable
        :busy="saving"
        @edit="openEdit"
        @toggle="toggle"
        @move="move"
    /></template>
    <div v-else-if="!loading && !error" class="personal-empty">
      <h2>Plats för din vecka</h2>
      <p>
        Importera en veckoplan för att börja. Dina planer sparas privat och
        delas inte med familjen.
      </p>
      <button class="secondary-button" @click="openImport">
        Importera vecka
      </button>
    </div>
    <dialog
      ref="importDialog"
      class="personal-dialog"
      aria-labelledby="personal-import-title"
      @close="!importDialog?.open && resetImport()"
      @cancel="cancelImport"
    >
      <div class="dialog-head">
        <h2 id="personal-import-title">Importera vecka</h2>
        <button
          aria-label="Stäng import"
          :disabled="saving"
          @click="closeImport"
        >
          <X />
        </button>
      </div>
      <template v-if="!preview"
        ><p>
          Klistra in JSON från din veckoplan. Den granskas innan något sparas.
        </p>
        <label
          >Veckoplan som JSON<textarea
            v-model="raw"
            rows="9"
            maxlength="200000"
            :disabled="saving"
            spellcheck="false"
          ></textarea></label
        ><button
          class="primary-button"
          :disabled="saving || !raw.trim()"
          @click="inspect"
        >
          Validera och förhandsgranska
        </button></template
      >
      <template v-else
        ><h3>
          Vecka {{ preview.week_number }} · {{ preview.year }} ·
          {{ weekTypes[preview.week_type] }}
        </h3>
        <p>Granska planen nedan innan du bekräftar.</p>
        <div v-if="existing" class="notice">
          <strong>Veckan finns redan.</strong>
          <p>
            Om du ersätter veckan försvinner tidigare innehåll, lokala ändringar
            och avbockningar som saknas i importen.
          </p>
          <label class="check-label"
            ><input v-model="replace" type="checkbox" :disabled="saving" />Jag
            vill ersätta den befintliga veckan</label
          >
        </div>
        <PersonalWeekPlan :plan="preview" />
        <div class="personal-actions">
          <button
            class="secondary-button"
            :disabled="saving"
            @click="editImport"
          >
            Ändra JSON</button
          ><button
            class="primary-button"
            :disabled="saving || (!!existing && !replace)"
            @click="importWeek"
          >
            {{
              saving
                ? 'Importerar…'
                : existing
                  ? 'Ersätt veckan'
                  : 'Bekräfta import'
            }}
          </button>
        </div></template
      >
      <p v-if="importError" role="alert" class="notice">{{ importError }}</p>
      <button class="text-link" :disabled="saving" @click="closeImport">
        Avbryt
      </button>
    </dialog>
    <dialog
      ref="editDialog"
      class="personal-dialog"
      aria-labelledby="personal-edit-title"
      @cancel="saving && $event.preventDefault()"
    >
      <div class="dialog-head">
        <h2 id="personal-edit-title">{{ editorTitle }}</h2>
        <button
          aria-label="Stäng redigering"
          :disabled="saving"
          @click="editDialog?.close()"
        >
          <X />
        </button>
      </div>
      <form v-if="draft" @submit.prevent="saveEdit()">
        <fieldset :disabled="saving">
          <template v-if="kind === 'item' && editedItem"
            ><label
              >Kategori<select v-model="editedItem.category">
                <option v-for="cat in categories" :key="cat" :value="cat">
                  {{ categoryLabels[cat] }}
                </option>
              </select></label
            ><label
              >Innehåll<textarea
                v-model="editedItem.content"
                maxlength="2000"
                required
                rows="4"
              ></textarea></label
          ></template>
          <label v-if="kind === 'day' && editedDay"
            >Prioritet<select v-model="editedDay.priority">
              <option
                v-for="(label, key) in priorityLabels"
                :key="key"
                :value="key"
              >
                {{ label }}
              </option>
            </select></label
          >
          <template v-if="kind === 'task' && editedTask"
            ><label
              >Kategori<select v-model="editedTask.category">
                <option v-for="cat in taskCategories" :key="cat" :value="cat">
                  {{ taskCategoryLabels[cat] }}
                </option>
              </select></label
            ><label
              >Uppgift<textarea
                v-model="editedTask.task"
                required
                maxlength="1000"
                rows="3"
              ></textarea></label
          ></template>
          <label v-if="kind === 'focus'"
            >Fokus, en etikett per rad<textarea
              v-model="focusText"
              rows="5"
              maxlength="809"
            ></textarea
            ><span class="small"
              >Högst tio etiketter, 80 tecken per etikett.</span
            ></label
          >
          <template v-if="kind === 'summary'"
            ><label
              >Veckotyp<select v-model="draft.week_type">
                <option
                  v-for="(label, key) in weekTypes"
                  :key="key"
                  :value="key"
                >
                  {{ label }}
                </option>
              </select></label
            ><label v-for="(label, key) in summaryLabels" :key="key"
              >{{ label
              }}<textarea
                v-model="draft.weekly_summary[key]"
                maxlength="3000"
                rows="2"
              ></textarea></label
          ></template>
          <div class="personal-actions">
            <button
              type="button"
              class="secondary-button"
              @click="editDialog?.close()"
            >
              Avbryt</button
            ><button class="primary-button">
              {{ saving ? 'Sparar…' : 'Spara ändring' }}
            </button>
          </div>
          <template v-if="kind === 'item' || kind === 'task'"
            ><button
              v-if="!deleting"
              type="button"
              class="text-link"
              @click="deleting = true"
            >
              Ta bort
            </button>
            <div v-else class="notice">
              <p>Vill du ta bort denna post?</p>
              <button type="button" @click="deleting = false">Behåll</button
              ><button type="button" @click="saveEdit(true)">
                Ja, ta bort
              </button>
            </div></template
          >
        </fieldset>
      </form>
      <p v-if="editError" role="alert" class="notice">{{ editError }}</p>
    </dialog>
  </section>
</template>
