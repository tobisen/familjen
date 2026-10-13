<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, Plus, Pencil, RotateCcw, ShoppingBasket } from 'lucide-vue-next'
import EmptyState from '../components/EmptyState.vue'
import { identity } from '../stores/auth'
import { today } from '../domain/calendar'
import { profiles } from '../domain/profiles'
import {
  filterTasks,
  taskTiming,
  activeShopping,
  shoppingHistory,
  priorityLabels,
  frequencyLabels,
  validateShopping,
  type TaskFilter,
  type ListKind,
  type Task,
  type ShoppingItem,
} from '../domain/lists'
import {
  tasks,
  shopping,
  listPeople,
  listsStatus,
  listsError,
  listsSync,
  listsWritable,
  pendingListIds,
  undoPurchase,
  reloadLists,
  openListEditor,
  editListItem,
  setListDone,
  restorePurchase,
  saveListItem,
} from '../stores/lists'
const route = useRoute(),
  router = useRouter()
const tab = computed(() => (route.query.tab === 'inkop' ? 'shopping' : 'task'))
const filter = ref<TaskFilter>('active')
const visibleTasks = computed(() =>
  filterTasks(tasks.value, filter.value, identity.value?.profile_key ?? null),
)
const active = computed(() => activeShopping(shopping.value)),
  history = computed(() => shoppingHistory(shopping.value))
const historyOpen = ref(false),
  error = ref(''),
  fastTitle = ref(''),
  fastAmount = ref(1),
  fastUnit = ref(''),
  adding = ref(false)
let fastRequest = crypto.randomUUID()
watch(
  [fastTitle, fastAmount, fastUnit],
  () => {
    fastRequest = crypto.randomUUID()
  },
  { flush: 'sync' },
)
function personName(id: string | null) {
  return listPeople.value.find((p) => p.id === id)?.name ?? 'Tidigare uppgift'
}
function assignedNames(task: Task) {
  return (
    task.assigned_ids
      .map((id) => profiles.find((p) => p.id === id)?.name)
      .join(', ') || 'Ingen tilldelad'
  )
}
async function toggle(
  kind: ListKind,
  item: Task | ShoppingItem,
  done: boolean,
) {
  if (pendingListIds.value.has(item.id)) return
  error.value = ''
  try {
    await setListDone(kind, item, done)
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : 'Ändringen kunde inte sparas.'
  }
}
async function undo() {
  error.value = ''
  try {
    await restorePurchase()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Kunde inte ångra.'
  }
}
async function addShopping() {
  if (adding.value) return
  const payload = {
    title: fastTitle.value.trim(),
    amount: Number(fastAmount.value),
    unit: fastUnit.value.trim(),
  }
  error.value = validateShopping(payload) ?? ''
  if (error.value) return
  adding.value = true
  try {
    await saveListItem('shopping', payload, null, null, fastRequest)
    fastTitle.value = ''
    fastAmount.value = 1
    fastUnit.value = ''
    fastRequest = crypto.randomUUID()
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : 'Kunde inte lägga till varan.'
  } finally {
    adding.value = false
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">VÅR GEMENSAMMA VARDAG</span>
      <h1>Listor</h1>
      <p>Lite mindre att komma ihåg.</p>
    </div>
    <span class="tag">Gemensamt för oss tre</span>
  </div>
  <div class="tabs" aria-label="Välj lista">
    <button :aria-pressed="tab === 'task'" @click="router.replace('/listor')">
      Att göra</button
    ><button
      :aria-pressed="tab === 'shopping'"
      @click="router.replace('/listor?tab=inkop')"
    >
      Inköp <span>{{ active.length }}</span>
    </button>
  </div>
  <p class="small" role="status">
    {{
      listsStatus === 'ready'
        ? listsSync
        : listsStatus === 'loading'
          ? 'Hämtar listorna…'
          : listsStatus === 'unconfigured'
            ? 'Supabase behöver konfigureras och enheten registreras.'
            : 'Listorna kunde inte uppdateras.'
    }}
  </p>
  <p v-if="listsError" class="notice" role="alert">
    {{ listsError }}
    <button class="secondary-button" @click="reloadLists">Försök igen</button>
  </p>
  <p v-if="error" class="notice" role="alert">{{ error }}</p>
  <section v-if="tab === 'task'" class="panel list-panel">
    <div class="panel-title">
      <h2>Att göra</h2>
      <button
        class="secondary-button"
        :disabled="!listsWritable"
        @click="openListEditor('task')"
      >
        <Plus :size="17" />Ny uppgift
      </button>
    </div>
    <div class="list-filters" aria-label="Filtrera uppgifter">
      <button
        v-for="option in [
          { id: 'all', name: 'Alla' },
          { id: 'mine', name: 'Mina' },
          { id: 'active', name: 'Aktiva' },
          { id: 'done', name: 'Klara' },
        ]"
        :key="option.id"
        :aria-pressed="filter === option.id"
        @click="filter = option.id as TaskFilter"
      >
        {{ option.name }}
      </button>
    </div>
    <div
      v-for="task in visibleTasks"
      :key="task.id"
      class="list-row task-row"
      :class="{ 'is-done': task.completed }"
    >
      <button
        class="check-item"
        :class="{ checked: task.completed }"
        :aria-label="`${task.completed ? 'Återställ' : 'Slutför'} ${task.title}`"
        :aria-pressed="task.completed"
        :disabled="!listsWritable || pendingListIds.has(task.id)"
        @click="toggle('task', task, !task.completed)"
      >
        <Check v-if="task.completed" :size="18" />
      </button>
      <div class="list-row-content">
        <h3>{{ task.title }}</h3>
        <p v-if="task.description" class="list-description">
          {{ task.description }}
        </p>
        <div class="list-meta">
          <span :class="{ overdue: taskTiming(task, today()) === 'Förfallen' }"
            >{{ taskTiming(task, today())
            }}{{ task.deadline ? ` · ${task.deadline}` : '' }}</span
          ><span class="priority-tag" :class="task.priority"
            >{{ priorityLabels[task.priority] }} prioritet</span
          ><span v-if="task.recurrence">{{
            frequencyLabels[task.recurrence]
          }}</span>
        </div>
        <p class="small">{{ assignedNames(task) }}</p>
        <p class="small">
          Skapad av {{ personName(task.created_by)
          }}<template v-if="task.completed">
            · Klar av {{ personName(task.completed_by) }}</template
          >
        </p>
      </div>
      <button
        class="row-edit"
        :aria-label="`Redigera ${task.title}`"
        :disabled="!listsWritable || pendingListIds.has(task.id)"
        @click="editListItem('task', task)"
      >
        <Pencil :size="18" />
      </button>
    </div>
    <EmptyState
      v-if="!visibleTasks.length && listsStatus === 'ready'"
      title="En sak i taget"
      description="Inga uppgifter i det här urvalet. Lägg till det ni vill få gjort."
    />
  </section>
  <section v-else class="panel list-panel">
    <div class="panel-title">
      <h2>Inköpslista</h2>
      <ShoppingBasket :size="24" />
    </div>
    <form class="shopping-quick" @submit.prevent="addShopping">
      <label class="shopping-name"
        >Varunamn<input
          v-model="fastTitle"
          placeholder="Vad saknas hemma?"
          autocomplete="off"
          maxlength="200"
          required
          :disabled="adding || !listsWritable"
      /></label>
      <div class="form-pair">
        <label
          >Antal<input
            v-model.number="fastAmount"
            type="number"
            inputmode="decimal"
            min="0.001"
            max="1000000"
            step="0.001"
            required
            :disabled="adding || !listsWritable" /></label
        ><label
          >Enhet (valfri)<input
            v-model="fastUnit"
            placeholder="t.ex. paket"
            maxlength="40"
            :disabled="adding || !listsWritable"
        /></label>
      </div>
      <button class="primary-button" :disabled="adding || !listsWritable">
        {{ adding ? 'Lägger till…' : 'Lägg till vara' }}
      </button>
    </form>
    <div v-if="undoPurchase" class="notice undo-purchase" role="status">
      <span>{{ undoPurchase.title }} är köpt.</span
      ><button
        :disabled="!listsWritable || pendingListIds.has(undoPurchase.id)"
        class="secondary-button"
        @click="undo"
      >
        <RotateCcw :size="15" />Ångra
      </button>
    </div>
    <h3 class="list-subheading">Kvar att köpa · {{ active.length }}</h3>
    <div v-for="item in active" :key="item.id" class="list-row shopping-row">
      <button
        class="check-item"
        :aria-label="`Köp ${item.title}`"
        :disabled="!listsWritable || pendingListIds.has(item.id)"
        @click="toggle('shopping', item, true)"
      ></button>
      <div class="list-row-content">
        <h3>{{ item.title }}</h3>
        <p class="small">{{ item.amount }} {{ item.unit }}</p>
      </div>
      <button
        class="row-edit"
        :aria-label="`Redigera ${item.title}`"
        :disabled="!listsWritable || pendingListIds.has(item.id)"
        @click="editListItem('shopping', item)"
      >
        <Pencil :size="18" />
      </button>
    </div>
    <EmptyState
      v-if="!active.length && listsStatus === 'ready'"
      title="Allt är handlat"
      description="Lägg till nästa sak som saknas hemma. Köpta varor finns i historiken."
    />
    <button
      class="history-toggle secondary-button"
      :aria-expanded="historyOpen"
      @click="historyOpen = !historyOpen"
    >
      Köphistorik · {{ history.length }}
    </button>
    <div v-if="historyOpen" class="purchase-history">
      <div v-for="item in history" :key="item.id" class="list-row">
        <div class="list-row-content">
          <h3>{{ item.title }}</h3>
          <p class="small">
            {{ item.amount }} {{ item.unit }} ·
            {{ personName(item.purchased_by)
            }}<template v-if="item.purchased_at">
              ·
              {{
                new Intl.DateTimeFormat('sv-SE', {
                  timeZone: 'Europe/Stockholm',
                  dateStyle: 'short',
                }).format(new Date(item.purchased_at))
              }}</template
            >
          </p>
        </div>
        <button
          class="row-edit"
          :aria-label="`Redigera ${item.title}`"
          :disabled="!listsWritable"
          @click="editListItem('shopping', item)"
        >
          <Pencil :size="17" /></button
        ><button
          class="secondary-button"
          :aria-label="`Återställ ${item.title}`"
          :disabled="!listsWritable || pendingListIds.has(item.id)"
          @click="toggle('shopping', item, false)"
        >
          <RotateCcw :size="16" /><span>Återställ</span>
        </button>
      </div>
      <p v-if="!history.length" class="small">Inga köpta varor ännu.</p>
    </div>
  </section>
</template>
