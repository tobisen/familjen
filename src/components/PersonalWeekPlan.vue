<script setup lang="ts">
import { computed } from 'vue'
import {
  BriefcaseBusiness,
  Dumbbell,
  Utensils,
  House,
  Users,
  MessagesSquare,
  Ellipsis,
  Heart,
  Moon,
  Pencil,
  Plus,
  ArrowUp,
  ArrowDown,
} from 'lucide-vue-next'
import {
  categoryLabels,
  taskCategoryLabels,
  categories,
  priorityLabels,
  summaryLabels,
  weekdays,
  type PersonalCategory,
  type PersonalPlan,
} from '../domain/personalWeek'
const props = defineProps<{
  plan: PersonalPlan
  editable?: boolean
  busy?: boolean
}>()
const emit = defineEmits<{
  edit: [
    kind: 'item' | 'day' | 'task' | 'focus' | 'summary',
    day?: number,
    index?: number,
  ]
  toggle: [kind: 'item' | 'task', day: number, index: number]
  move: [day: number, index: number, step: number]
}>()
const icons: Record<PersonalCategory, unknown> = {
  work: BriefcaseBusiness,
  training: Dumbbell,
  meal: Utensils,
  home: House,
  family: Users,
  social: MessagesSquare,
  other: Ellipsis,
  selfCare: Heart,
  recovery: Moon,
}
function siblingStep(
  day: PersonalPlan['days'][number],
  index: number,
  direction: number,
) {
  for (
    let target = index + direction;
    target >= 0 && target < day.items.length;
    target += direction
  ) {
    if (day.items[target]!.category === day.items[index]!.category)
      return target - index
  }
  return 0
}
const summaryKeys = computed(() =>
  (Object.keys(summaryLabels) as (keyof typeof summaryLabels)[]).filter(
    (key) => props.plan.weekly_summary[key],
  ),
)
const completed = computed(() => props.plan.tasks.filter((t) => t.done).length)
</script>
<template>
  <div class="personal-plan">
    <div class="focus-tags">
      <span v-for="focus in plan.focus" :key="focus" class="focus-tag">{{
        focus
      }}</span>
      <button
        v-if="editable"
        :disabled="busy"
        class="text-link"
        @click="emit('edit', 'focus')"
      >
        <Pencil :size="14" /> Ändra fokus
      </button>
    </div>
    <div class="personal-days">
      <details
        v-for="(day, di) in plan.days"
        :key="day.date"
        class="personal-day"
        :open="day.items.length > 0"
      >
        <summary>
          <span
            >{{ weekdays[di] }}
            <small
              >{{ day.date.slice(8) }}/{{ day.date.slice(5, 7) }}</small
            ></span
          ><span class="priority-tag" :class="day.priority"
            >{{ priorityLabels[day.priority] }} prioritet</span
          >
        </summary>
        <div class="personal-day-body">
          <div
            v-for="cat in categories.filter((c) =>
              day.items.some((i) => i.category === c),
            )"
            :key="cat"
            class="personal-category"
          >
            <h3>
              <component :is="icons[cat]" :size="16" />{{ categoryLabels[cat] }}
            </h3>
            <div
              v-for="{ item, index } in day.items
                .map((item, index) => ({ item, index }))
                .filter(({ item }) => item.category === cat)"
              :key="item.id ?? index"
              class="personal-item"
            >
              <input
                v-if="editable"
                type="checkbox"
                :checked="item.done"
                :disabled="busy"
                :aria-label="`Klar: ${item.content}`"
                @change="emit('toggle', 'item', di, index)"
              />
              <span :class="{ 'personal-done': item.done }">{{
                item.content
              }}</span>
              <div v-if="editable" class="personal-item-actions">
                <button
                  :disabled="busy"
                  :aria-label="`Redigera ${item.content}`"
                  @click="emit('edit', 'item', di, index)"
                >
                  <Pencil :size="15" />
                </button>
                <button
                  :disabled="busy || !siblingStep(day, index, -1)"
                  :aria-label="`Flytta upp ${item.content}`"
                  @click="emit('move', di, index, siblingStep(day, index, -1))"
                >
                  <ArrowUp :size="15" />
                </button>
                <button
                  :disabled="busy || !siblingStep(day, index, 1)"
                  :aria-label="`Flytta ned ${item.content}`"
                  @click="emit('move', di, index, siblingStep(day, index, 1))"
                >
                  <ArrowDown :size="15" />
                </button>
              </div>
            </div>
          </div>
          <p v-if="!day.items.length">Inget planerat ännu.</p>
          <div v-if="editable" class="personal-actions">
            <button
              class="text-link"
              :disabled="busy"
              :aria-label="`Lägg till post ${day.date}`"
              @click="emit('edit', 'item', di)"
            >
              <Plus :size="16" /> Lägg till
            </button>
            <button
              class="text-link"
              :disabled="busy"
              :aria-label="`Ändra prioritet ${day.date}`"
              @click="emit('edit', 'day', di)"
            >
              Prioritet
            </button>
          </div>
        </div>
      </details>
    </div>
    <details class="personal-section" open>
      <summary>Veckans helhet</summary>
      <dl class="personal-summary">
        <template v-for="key in summaryKeys" :key="key"
          ><dt>{{ summaryLabels[key] }}</dt>
          <dd>{{ plan.weekly_summary[key] || 'Inte planerat' }}</dd></template
        >
      </dl>
      <p v-if="!summaryKeys.length">Ingen sammanfattning ännu.</p>
      <button
        v-if="editable"
        class="text-link"
        :disabled="busy"
        @click="emit('edit', 'summary')"
      >
        <Pencil :size="15" /> Redigera sammanfattning
      </button>
    </details>
    <section class="personal-section" aria-label="Veckouppgifter">
      <div class="personal-heading">
        <h2>Veckouppgifter</h2>
        <span>{{ completed }}/{{ plan.tasks.length }} klara</span>
      </div>
      <progress
        v-if="plan.tasks.length"
        :value="completed"
        :max="plan.tasks.length"
        :aria-label="`${completed} av ${plan.tasks.length} uppgifter klara`"
      ></progress>
      <div
        v-for="(task, index) in plan.tasks"
        :key="task.id ?? index"
        class="personal-item"
      >
        <input
          v-if="editable"
          type="checkbox"
          :checked="task.done"
          :disabled="busy"
          :aria-label="`Klar: ${task.task}`"
          @change="emit('toggle', 'task', 0, index)"
        />
        <span :class="{ 'personal-done': task.done }"
          >{{ task.task
          }}<small class="personal-task-category">{{
            taskCategoryLabels[task.category]
          }}</small></span
        >
        <button
          v-if="editable"
          :disabled="busy"
          :aria-label="`Redigera ${task.task}`"
          @click="emit('edit', 'task', 0, index)"
        >
          <Pencil :size="16" />
        </button>
      </div>
      <p v-if="!plan.tasks.length">Inga veckouppgifter ännu.</p>
      <button
        v-if="editable"
        class="text-link"
        :disabled="busy"
        @click="emit('edit', 'task')"
      >
        <Plus :size="16" /> Ny veckouppgift
      </button>
    </section>
  </div>
</template>
