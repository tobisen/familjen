<script setup lang="ts">
import type { Occurrence } from '../domain/calendar'
import { timeLabel } from '../domain/calendar'
import { people, detail } from '../stores/calendar'
defineProps<{ occurrence: Occurrence; compact?: boolean }>()
</script>
<template>
  <button
    class="calendar-event"
    :class="[
      people.find((p) => p.id === occurrence.activity.participant_ids[0])
        ?.color,
      { compact },
    ]"
    :aria-label="`${occurrence.activity.title}, ${occurrence.activity.all_day ? 'heldag' : timeLabel(occurrence.starts_at)}`"
    @click.stop="detail = occurrence"
  >
    <span class="event-time"
      >{{
        occurrence.activity.all_day
          ? 'Heldag'
          : `${timeLabel(occurrence.starts_at)}–${timeLabel(occurrence.ends_at)}`
      }}<span v-if="occurrence.activity.category === 'school'">
        · Skola</span
      ></span
    ><strong>{{ occurrence.activity.title }}</strong
    ><span v-if="!compact" class="event-location">{{
      occurrence.activity.location
    }}</span
    ><span class="event-persons"
      ><span
        v-for="p in people.filter((p) =>
          occurrence.activity.participant_ids.includes(p.id),
        )"
        :key="p.id"
        :class="p.color"
        >{{ p.display_name }}</span
      ></span
    >
  </button>
</template>
