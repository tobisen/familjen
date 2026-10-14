<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { identity } from '../stores/auth'
import {
  pushSupport,
  enablePush,
  restorePush,
  testPush,
} from '../services/push'
const props = defineProps<{ compact?: boolean }>()
const permission = ref(
  'Notification' in window ? Notification.permission : 'unsupported',
)
const connected = ref(false),
  busy = ref(false),
  error = ref(''),
  result = ref('')
const unsupported = computed(() => pushSupport())
async function refresh() {
  permission.value =
    'Notification' in window ? Notification.permission : 'unsupported'
  if (permission.value !== 'granted') connected.value = false
  if (identity.value && !unsupported.value && permission.value === 'granted')
    try {
      connected.value = await restorePush(identity.value.profile_id)
      if (connected.value) error.value = ''
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Push kunde inte anslutas.'
    }
}
async function enable() {
  if (!identity.value) return
  busy.value = true
  error.value = ''
  try {
    connected.value = await enablePush(identity.value.profile_id)
    permission.value = Notification.permission
    result.value = 'Enheten är ansluten för familjens notiser.'
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : 'Kunde inte aktivera notiser.'
  } finally {
    busy.value = false
    permission.value =
      'Notification' in window ? Notification.permission : 'unsupported'
  }
}
async function test() {
  busy.value = true
  error.value = ''
  try {
    await testPush()
    result.value =
      'Testnotisen är köad. Den skickas normalt inom en minut, även om appen stängs.'
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : 'Testnotisen kunde inte skickas.'
  } finally {
    busy.value = false
  }
}
onMounted(() => {
  void refresh()
  window.addEventListener('focus', refresh)
})
onUnmounted(() => window.removeEventListener('focus', refresh))
</script>
<template>
  <section
    v-if="
      identity &&
      (!props.compact || permission !== 'granted' || !connected || error)
    "
    class="panel settings-panel"
  >
    <h2>Notiser på den här enheten</h2>
    <p>
      Familjens meddelanden, aktiviteter, uppgifter och inköp ger automatiskt
      notiser när telefonen tillåter det.
    </p>
    <p v-if="unsupported" class="notice">{{ unsupported }}</p>
    <p v-else>
      Telefonens behörighet:
      <strong>{{
        permission === 'granted'
          ? 'Tillåten'
          : permission === 'denied'
            ? 'Nekad'
            : 'Inte vald'
      }}</strong>
      · {{ connected ? 'Ansluten' : 'Inte ansluten' }}
    </p>
    <p v-if="permission === 'denied'">
      Android: öppna webbplatsens inställningar i Chrome → Behörigheter →
      Aviseringar. iPhone: Inställningar → Appar → Familjen → Notiser. Tillåt
      notiser där och öppna Familjen igen.
    </p>
    <button
      v-if="!unsupported && permission !== 'denied' && !connected"
      class="primary-button"
      :disabled="busy"
      @click="enable"
    >
      {{ busy ? 'Ansluter…' : 'Aktivera notiser' }}
    </button>
    <button
      v-if="connected && permission === 'granted'"
      class="secondary-button"
      :disabled="busy"
      @click="test"
    >
      Skicka testnotis
    </button>
    <p v-if="error" role="alert" class="notice">{{ error }}</p>
    <p v-if="result" role="status" class="notice">{{ result }}</p>
    <p class="small">
      Telefonen kan fördröja leveransen vid exempelvis batterisparläge eller
      nätverksproblem. Web Push på iPhone kräver iOS 16.4 eller senare och
      installation på hemskärmen.
    </p>
  </section>
</template>
