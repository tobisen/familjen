<script setup lang="ts">
import { computed } from 'vue'
import { CheckCheck, ShoppingBasket, MessageCircle } from 'lucide-vue-next'
import { filterTasks } from '../domain/lists'
import { tasks, remainingShopping } from '../stores/lists'
import { chatSummary } from '../stores/chat'
const active = computed(() => filterTasks(tasks.value, 'active', null))
</script>
<template>
  <div class="overview-strip" aria-label="Vardagen just nu">
    <RouterLink to="/listor?tab=todo"
      ><CheckCheck :size="18" /><span
        ><strong>{{ active.length }}</strong> uppgifter<small>{{
          active[0]?.title ?? 'Allt klart just nu'
        }}</small></span
      ></RouterLink
    >
    <RouterLink to="/listor?tab=inkop"
      ><ShoppingBasket :size="18" /><span
        ><strong>{{ remainingShopping }}</strong> att handla</span
      ></RouterLink
    >
    <RouterLink to="/chatt"
      ><MessageCircle :size="18" /><span
        >{{
          chatSummary.last_message
            ? chatSummary.people.find(
                (p) => p.id === chatSummary.last_message?.sender_id,
              )?.name
            : 'Familjechatten'
        }}<small v-if="chatSummary.last_message">{{
          chatSummary.last_message.body
        }}</small></span
      ></RouterLink
    >
  </div>
</template>
