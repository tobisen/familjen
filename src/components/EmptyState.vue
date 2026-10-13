<script setup lang="ts">
import { Sprout } from 'lucide-vue-next'
defineProps<{ title: string; description: string; prepared?: boolean }>()
</script>
<template>
  <div class="empty">
    <span class="empty-icon"><Sprout :size="28" /></span>
    <h3>{{ title }}</h3>
    <p>{{ description }}</p>
    <span v-if="prepared" class="tag">Förberett för nästa fas</span>
  </div>
</template>
