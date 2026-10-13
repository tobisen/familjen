<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { X } from 'lucide-vue-next'
import {
  detail,
  people,
  openEdit,
  deleteActivity,
  saveActivity,
  saving,
  canWrite,
} from '../stores/calendar'
import {
  dateLabel,
  timeLabel,
  addDays,
  localParts,
  type ActivityInput,
} from '../domain/calendar'
const occurrence = detail.value!
const activity = occurrence.activity
const endDay = activity.all_day
  ? addDays(localParts(occurrence.ends_at).date, -1)
  : localParts(occurrence.ends_at).date
const dialog = ref<HTMLDialogElement | null>(null)
const confirm = ref(false)
const error = ref('')
onMounted(() => dialog.value?.showModal())
function close() {
  if (!saving.value) detail.value = null
}
async function remove() {
  try {
    await deleteActivity(activity.id, activity.version)
    detail.value = null
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Radering misslyckades.'
  }
}
async function skip() {
  try {
    const input: ActivityInput = {
      ...activity,
      exception_dates: [
        ...new Set([...activity.exception_dates, occurrence.date]),
      ],
    }
    await saveActivity(input, activity.id, activity.version)
    detail.value = null
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : 'Kunde inte undanta tillfället.'
  }
}
</script>
<template>
  <dialog ref="dialog" aria-labelledby="detail-heading" @cancel.prevent="close">
    <div class="dialog-head">
      <h2 id="detail-heading">{{ activity.title }}</h2>
      <button aria-label="Stäng" :disabled="saving" @click="close">
        <X />
      </button>
    </div>
    <p>
      {{
        dateLabel(occurrence.date, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      }}
    </p>
    <p v-if="endDay !== occurrence.date" class="small">
      Till och med
      {{
        dateLabel(endDay, { day: 'numeric', month: 'long', year: 'numeric' })
      }}
    </p>
    <p>
      {{
        activity.all_day
          ? 'Heldag'
          : `${timeLabel(occurrence.starts_at)}–${timeLabel(occurrence.ends_at)}`
      }}
      · Stockholmstid
    </p>
    <p v-if="activity.location" class="detail-block">
      <strong>Plats</strong><br />{{ activity.location }}
    </p>
    <p v-if="activity.description" class="detail-block preserve-lines">
      {{ activity.description }}
    </p>
    <div class="participant-chips">
      <span
        v-for="p in people.filter((p) =>
          activity.participant_ids.includes(p.id),
        )"
        :key="p.id"
        class="person-chip"
        :class="p.color"
        >{{ p.display_name }}</span
      >
    </div>
    <p v-if="activity.recurrence" class="small">
      Återkommande serie. Redigering gäller hela serien; ett undantag hoppar
      över enbart detta tillfälle.
    </p>
    <p v-if="occurrence.school" class="notice">
      Importerad lektion. Ändra tider och lov via en ny schemaimport med samma
      externa ID.
    </p>
    <p v-if="error" class="notice" role="alert">{{ error }}</p>
    <div v-if="!occurrence.school && canWrite" class="form-actions">
      <button
        class="secondary-button"
        :disabled="saving"
        @click="openEdit(occurrence)"
      >
        Redigera</button
      ><button
        v-if="activity.recurrence"
        class="secondary-button"
        :disabled="saving"
        @click="skip"
      >
        Undanta {{ occurrence.date }}</button
      ><button class="danger-button" :disabled="saving" @click="confirm = true">
        Radera
      </button>
    </div>
    <div v-if="confirm" class="delete-confirm" role="alert">
      <p>
        {{
          activity.recurrence
            ? 'Radera hela den återkommande serien?'
            : 'Vill du radera aktiviteten?'
        }}
      </p>
      <button class="danger-button" :disabled="saving" @click="remove">
        Ja, radera</button
      ><button
        class="secondary-button"
        :disabled="saving"
        @click="confirm = false"
      >
        Behåll
      </button>
    </div>
    <p class="small">
      Kalendern är offentlig och kan redigeras av alla besökare.
    </p>
  </dialog>
</template>
