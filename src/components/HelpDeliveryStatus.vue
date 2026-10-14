<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { createMapRepository } from '../data/mapRepository'
import { helpDeliveryLabel, type HelpDelivery } from '../domain/location'
const props = defineProps<{ messageId: string; createdAt: string }>()
const deliveries = ref<HelpDelivery[]>([]),
  state = ref('Kontrollerar pushstatus…')
const repository = createMapRepository()
let timer: ReturnType<typeof setInterval> | null = null,
  alive = true,
  busy = false
async function refresh() {
  if (!repository || busy || document.visibilityState !== 'visible') return
  busy = true
  try {
    const rows = await repository.helpStatus(props.messageId)
    if (alive) {
      deliveries.value = rows
      state.value = rows.length ? '' : 'Pushstatus är inte längre tillgänglig.'
    }
  } catch {
    if (alive) {
      deliveries.value = []
      state.value = 'Pushstatus kunde inte bekräftas.'
    }
  } finally {
    busy = false
  }
}
onMounted(() => {
  void refresh()
  if (Date.now() - Date.parse(props.createdAt) < 3600000)
    timer = setInterval(() => {
      void refresh()
      if (Date.now() - Date.parse(props.createdAt) >= 3600000 && timer) {
        clearInterval(timer)
        timer = null
      }
    }, 15000)
})
onUnmounted(() => {
  alive = false
  if (timer) clearInterval(timer)
})
</script>
<template>
  <div class="help-delivery-status" role="status">
    <p v-if="state">{{ state }}</p>
    <p v-for="d in deliveries" :key="d.name">
      {{ d.name }}: {{ helpDeliveryLabel(d) }}
    </p>
  </div>
</template>
