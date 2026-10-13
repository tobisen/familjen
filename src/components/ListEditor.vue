<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'
import { X, Trash2 } from 'lucide-vue-next'
import { profiles } from '../domain/profiles'
import { identity } from '../stores/auth'
import { listEditor, saveListItem, deleteListItem } from '../stores/lists'
import {
  validateTask,
  validateShopping,
  type Task,
  type ShoppingItem,
  type TaskInput,
  type ShoppingInput,
} from '../domain/lists'
const source = listEditor.value!
const task = source.kind === 'task'
const existing = source.item
const taskSource = existing as Task | null
const shopSource = existing as ShoppingItem | null
const title = ref(existing?.title ?? '')
const description = ref(taskSource?.description ?? '')
const deadline = ref(taskSource?.deadline ?? '')
const priority = ref<TaskInput['priority']>(taskSource?.priority ?? 'normal')
const assigned = ref<TaskInput['assigned_ids']>(
  taskSource?.assigned_ids ??
    (identity.value ? [identity.value.profile_key] : []),
)
const recurrence = ref<TaskInput['recurrence']>(taskSource?.recurrence ?? null)
const reminder = ref<number | null>(taskSource?.reminder_days ?? null)
const amount = ref(shopSource?.amount ?? 1)
const unit = ref(shopSource?.unit ?? '')
const busy = ref(false),
  error = ref(''),
  confirmDelete = ref(false)
const dialog = ref<HTMLDialogElement | null>(null)
let request = source.request
watch(
  [
    title,
    description,
    deadline,
    priority,
    assigned,
    recurrence,
    reminder,
    amount,
    unit,
  ],
  () => {
    request = crypto.randomUUID()
  },
  { deep: true, flush: 'sync' },
)
const heading = computed(
  () => `${existing ? 'Redigera' : 'Ny'} ${task ? 'uppgift' : 'vara'}`,
)
onMounted(() => dialog.value?.showModal())
function close() {
  if (!busy.value) listEditor.value = null
}
async function save() {
  if (busy.value) return
  const payload: TaskInput | ShoppingInput = task
    ? {
        title: title.value.trim(),
        description: description.value,
        deadline: deadline.value || null,
        priority: priority.value,
        assigned_ids: assigned.value,
        recurrence: recurrence.value,
        reminder_days:
          reminder.value === null || String(reminder.value) === ''
            ? null
            : Number(reminder.value),
      }
    : {
        title: title.value.trim(),
        amount: Number(amount.value),
        unit: unit.value.trim(),
      }
  error.value =
    (task
      ? validateTask(payload as TaskInput)
      : validateShopping(payload as ShoppingInput)) ?? ''
  if (error.value) return
  busy.value = true
  try {
    await saveListItem(
      source.kind,
      payload,
      existing?.id ?? null,
      existing?.version ?? null,
      request,
    )
    if (listEditor.value === source) listEditor.value = null
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Kunde inte spara.'
  } finally {
    busy.value = false
  }
}
async function remove() {
  if (!existing || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await deleteListItem(source.kind, existing.id, existing.version)
    if (listEditor.value === source) listEditor.value = null
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Kunde inte radera.'
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <dialog
    ref="dialog"
    class="list-editor"
    aria-labelledby="list-editor-title"
    @cancel.prevent="close"
  >
    <div class="dialog-head">
      <h2 id="list-editor-title">{{ heading }}</h2>
      <button aria-label="Stäng" :disabled="busy" @click="close"><X /></button>
    </div>
    <form class="list-form" @submit.prevent="save">
      <fieldset class="list-fields" :disabled="busy">
        <label
          >{{ task ? 'Titel' : 'Varunamn'
          }}<input
            v-model="title"
            autofocus
            required
            maxlength="200"
            autocomplete="off"
        /></label>
        <template v-if="task">
          <label
            >Beskrivning<textarea
              v-model="description"
              rows="3"
              maxlength="5000"
            ></textarea>
          </label>
          <fieldset>
            <legend>Ansvariga</legend>
            <div class="people-checks">
              <label v-for="person in profiles" :key="person.id"
                ><input
                  v-model="assigned"
                  type="checkbox"
                  :value="person.id"
                />{{ person.name }}</label
              >
            </div>
          </fieldset>
          <div class="form-pair">
            <label
              >Deadline<input
                v-model="deadline"
                type="date"
                min="2000-01-01"
                max="2100-12-31"
                :required="!!recurrence" /></label
            ><label
              >Prioritet<select v-model="priority" aria-label="Prioritet">
                <option value="low">Låg</option>
                <option value="normal">Normal</option>
                <option value="high">Hög</option>
              </select></label
            >
          </div>
          <label
            >Återkomst<select v-model="recurrence" aria-label="Återkomst">
              <option :value="null">Ingen</option>
              <option value="daily">Dagligen</option>
              <option value="weekly">Veckovis</option>
              <option value="monthly">Månadsvis</option>
            </select></label
          >
          <p v-if="recurrence" class="small">
            Nästa uppgift skapas när denna slutförs. Deadline följer serien,
            även om ett tillfälle blir försenat.
          </p>
          <details>
            <summary>Förbered framtida påminnelse</summary>
            <label
              >Dagar före deadline<input
                v-model="reminder"
                type="number"
                min="0"
                max="365"
                step="1"
                placeholder="Ingen"
            /></label>
            <p class="small">
              Valet sparas. Push och påminnelser skickas ännu inte.
            </p>
          </details>
        </template>
        <div v-else class="form-pair">
          <label
            >Antal<input
              v-model.number="amount"
              type="number"
              inputmode="decimal"
              min="0.001"
              max="1000000"
              step="0.001"
              required /></label
          ><label
            >Enhet (valfri)<input
              v-model="unit"
              maxlength="40"
              placeholder="t.ex. kg, liter, paket"
          /></label>
        </div>
        <p v-if="error" class="notice" role="alert">{{ error }}</p>
        <button class="primary-button" :disabled="busy">
          {{ busy ? 'Sparar…' : 'Spara' }}
        </button>
      </fieldset>
    </form>
    <template v-if="existing"
      ><button
        v-if="!confirmDelete"
        class="text-link danger-link"
        :disabled="busy"
        @click="confirmDelete = true"
      >
        <Trash2 :size="17" />Radera {{ task ? 'uppgift' : 'vara' }}
      </button>
      <div v-else class="notice">
        <p>Vill du radera {{ existing.title }}?</p>
        <button class="secondary-button" :disabled="busy" @click="remove">
          Ja, radera
        </button>
        <button
          class="secondary-button"
          :disabled="busy"
          @click="confirmDelete = false"
        >
          Avbryt
        </button>
      </div></template
    >
  </dialog>
</template>
