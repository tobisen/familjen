<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { X } from 'lucide-vue-next'
import {
  editor,
  activities,
  people,
  saveActivity,
  saving,
} from '../stores/calendar'
import { selectedProfile } from '../domain/profiles'
import {
  addDays,
  localParts,
  toInstant,
  validateActivity,
  type ActivityInput,
} from '../domain/calendar'
const state = editor.value!
const original = state.id
  ? activities.value.find((a) => a.id === state.id)
  : null
const first = original
  ? localParts(original.starts_at)
  : { date: state.date, time: state.time }
const last = original
  ? localParts(original.ends_at)
  : {
      date: state.date,
      time:
        state.time === '23:00'
          ? '23:59'
          : `${String(Number(state.time.slice(0, 2)) + 1).padStart(2, '0')}:00`,
    }
const title = ref(original?.title ?? '')
const description = ref(original?.description ?? '')
const location = ref(original?.location ?? '')
const allDay = ref(original?.all_day ?? state.allDay ?? false)
const startDate = ref(first.date)
const endDate = ref(original?.all_day ? addDays(last.date, -1) : last.date)
const startTime = ref(first.time)
const endTime = ref(last.time)
const participants = ref(
  original
    ? [...original.participant_ids]
    : [selectedProfile.value ?? 'tobias'],
)
const frequency = ref(original?.recurrence?.frequency ?? 'none')
const interval = ref(original?.recurrence?.interval ?? 1)
const until = ref(original?.recurrence?.until ?? '')
const category = ref(original?.category ?? 'family')
const exceptions = ref(original?.exception_dates.join(', ') ?? '')
const dst = ref<'reject' | 'earlier' | 'later'>('reject')
const error = ref('')
const dialog = ref<HTMLDialogElement | null>(null)
const heading = computed(() =>
  state.id ? 'Redigera aktivitet' : 'Ny aktivitet',
)
onMounted(() => dialog.value?.showModal())
function close() {
  if (!saving.value) editor.value = null
}
async function submit() {
  error.value = ''
  try {
    const input: ActivityInput = {
      title: title.value.trim(),
      description: description.value,
      location: location.value,
      all_day: allDay.value,
      starts_at: toInstant(
        startDate.value,
        allDay.value ? '00:00' : startTime.value,
        dst.value,
      ),
      ends_at: toInstant(
        allDay.value ? addDays(endDate.value, 1) : endDate.value,
        allDay.value ? '00:00' : endTime.value,
        dst.value,
      ),
      participant_ids: participants.value,
      category: category.value,
      recurrence:
        frequency.value === 'none'
          ? null
          : {
              frequency: frequency.value as 'daily' | 'weekly' | 'monthly',
              interval: Number(interval.value),
              until: until.value || null,
            },
      exception_dates: exceptions.value.split(/[\s,]+/).filter(Boolean),
    }
    validateActivity(input)
    await saveActivity(input, state.id, original?.version ?? null)
    editor.value = null
  } catch (e) {
    error.value =
      e instanceof RangeError
        ? 'Tiden är ogiltig eller inträffar två gånger vid tidsomställning. Kontrollera datum och välj första/andra förekomsten nedan.'
        : e instanceof Error
          ? e.message
          : 'Kunde inte spara.'
  }
}
</script>
<template>
  <dialog
    ref="dialog"
    class="event-dialog"
    aria-labelledby="editor-heading"
    @cancel.prevent="close"
  >
    <form @submit.prevent="submit">
      <div class="dialog-head">
        <h2 id="editor-heading">{{ heading }}</h2>
        <button
          type="button"
          aria-label="Stäng"
          :disabled="saving"
          @click="close"
        >
          <X />
        </button>
      </div>
      <p class="public-warning">
        Offentlig kalender: alla som hittar adressen kan läsa och ändra
        aktiviteten.
      </p>
      <p v-if="original?.recurrence" class="notice">
        Du redigerar hela serien. Undantag för enstaka tillfällen görs i
        detaljvyn.
      </p>
      <label
        >Titel<input
          v-model="title"
          name="title"
          required
          maxlength="200"
          autofocus /></label
      ><label
        >Beskrivning<textarea
          v-model="description"
          name="description"
          maxlength="10000"
          rows="2"
        ></textarea></label
      ><label>Plats<input v-model="location" maxlength="500" /></label
      ><label class="check-label"
        ><input v-model="allDay" type="checkbox" />Heldag</label
      >
      <div class="form-row">
        <label
          >Startdatum<input v-model="startDate" type="date" required /></label
        ><label v-if="!allDay"
          >Starttid<input v-model="startTime" type="time" required
        /></label>
      </div>
      <div class="form-row">
        <label>Slutdatum<input v-model="endDate" type="date" required /></label
        ><label v-if="!allDay"
          >Sluttid<input v-model="endTime" type="time" required
        /></label>
      </div>
      <p class="small">
        Alla tider gäller Europe/Stockholm. Slutdatum för heldag är sista dagen
        som visas.
      </p>
      <fieldset>
        <legend>Deltagare</legend>
        <label v-for="p in people" :key="p.id" class="check-label"
          ><input v-model="participants" type="checkbox" :value="p.id" /><span
            class="person-dot"
            :class="p.color"
          ></span
          >{{ p.display_name }}</label
        >
      </fieldset>
      <label
        >Kategori<select v-model="category">
          <option value="family">Familj</option>
          <option value="school">Skola</option>
        </select></label
      >
      <div class="form-row">
        <label
          >Upprepning<select v-model="frequency">
            <option value="none">Ingen</option>
            <option value="daily">Dagligen</option>
            <option value="weekly">Veckovis</option>
            <option value="monthly">Månadsvis</option>
          </select></label
        ><label v-if="frequency !== 'none'"
          >Intervall<input
            v-model="interval"
            type="number"
            min="1"
            max="52"
            required
        /></label>
      </div>
      <label v-if="frequency !== 'none'"
        >Upprepa till och med<input v-model="until" type="date" /><span
          class="small"
          >Tomt = tills serien ändras manuellt.</span
        ></label
      ><label
        >Undantagsdatum<textarea
          v-model="exceptions"
          placeholder="YYYY-MM-DD, YYYY-MM-DD"
          rows="2"
        ></textarea>
      </label>
      <details>
        <summary>Tidsomställning</summary>
        <label
          >Dubblerad hösttimme<select v-model="dst">
            <option value="reject">Kräv entydig tid</option>
            <option value="earlier">Första förekomsten (sommartid)</option>
            <option value="later">Andra förekomsten (vintertid)</option>
          </select></label
        >
        <p class="small">
          Vårens saknade timme ska väljas om. Återkommande serier hoppar över
          saknade tider och använder första förekomsten av höstens dubbla timme.
        </p>
      </details>
      <p v-if="error" role="alert" class="notice">{{ error }}</p>
      <div class="form-actions">
        <button
          type="button"
          class="secondary-button"
          :disabled="saving"
          @click="close"
        >
          Avbryt</button
        ><button class="primary-button" :disabled="saving">
          {{ saving ? 'Sparar…' : 'Spara aktivitet' }}
        </button>
      </div>
    </form>
  </dialog>
</template>
