<script setup lang="ts">
import { ref } from 'vue'
import { resetAppResources } from '../services/pwaRecovery'
const recoverUrl = import.meta.env.BASE_URL + 'recover/'
const working = ref(false)
const error = ref('')
async function reset() {
  working.value = true
  error.value = ''
  try {
    await resetAppResources()
  } catch {
    error.value =
      'Återställningen misslyckades. Kontrollera nätverket och försök igen.'
    working.value = false
  }
}
</script>
<template>
  <section class="panel settings-panel">
    <h2>Hjälp med installation och start</h2>
    <p>
      Rensa enbart appens cache och service worker. Din inloggning och
      serverlagrade familjedata behålls.
    </p>
    <button class="secondary-button" :disabled="working" @click="reset">
      {{ working ? 'Återställer…' : 'Återställ appens cache' }}
    </button>
    <p v-if="error" role="alert">{{ error }}</p>
    <a :href="recoverUrl" class="text-link">Öppna fristående starthjälp</a>
  </section>
</template>
