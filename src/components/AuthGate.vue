<script setup lang="ts">
import CodeRegistration from './CodeRegistration.vue'
import PwaTools from './PwaTools.vue'
import { ref } from 'vue'
import {
  authStatus,
  authError,
  authBusy,
  registration,
  registerDevice,
  requestEmailLink,
  restoreIdentity,
  signOut,
} from '../stores/auth'
const email = ref('')
const emailBusy = ref(false)
const message = ref('')
async function send() {
  message.value = ''
  emailBusy.value = true
  try {
    await requestEmailLink(email.value)
    message.value =
      'Om adressen har ett registrerat konto skickas en personlig länk. Öppna den på den här enheten.'
  } catch (e) {
    message.value = e instanceof Error ? e.message : 'Kunde inte skicka länk.'
  } finally {
    emailBusy.value = false
  }
}
</script>
<template>
  <section class="onboarding auth-gate">
    <span class="eyebrow">FAMILJEN · EN PRIVAT PLATS</span>
    <h1>Välkommen hem.</h1>
    <p v-if="authStatus === 'loading'" role="status">
      Återställer din säkra session…
    </p>
    <template v-else
      ><p>
        Välj ditt namn och logga in med din personliga kod. Sessionen sparas,
        och samma kod kan användas igen om du behöver logga in på nytt.
      </p>
      <p v-if="authError" role="alert" class="notice">{{ authError }}</p>
      <template v-if="registration"
        ><button
          class="primary-button"
          :disabled="authBusy"
          @click="registerDevice"
        >
          {{ authBusy ? 'Registrerar…' : 'Registrera den här enheten' }}
        </button>
        <p class="small">
          Länken är personlig, kan användas en gång och ska inte delas vidare.
        </p></template
      ><template v-else-if="authStatus === 'unregistered'"
        ><p class="notice">
          Kontot är inloggat men saknar familjekoppling. Administratören behöver
          koppla det till rätt profil.
        </p>
        <button class="secondary-button" @click="restoreIdentity()">
          Kontrollera igen</button
        ><button class="secondary-button" @click="signOut">
          Logga ut
        </button></template
      ><template v-else
        ><p class="notice">
          Ange den personliga koden som utfärdats för just din profil.
        </p>
        <CodeRegistration />
        <details>
          <summary>Har du redan ett konto med e-post?</summary>
          <form class="auth-email-form" @submit.prevent="send">
            <label
              >E-postadress<input
                v-model="email"
                type="email"
                autocomplete="email"
                required /></label
            ><button class="primary-button" :disabled="emailBusy">
              {{ emailBusy ? 'Skickar…' : 'Skicka personlig länk' }}
            </button>
          </form>
          <p v-if="message" role="status" class="small">{{ message }}</p>
        </details>
        <button
          v-if="authStatus === 'error'"
          class="secondary-button"
          @click="restoreIdentity()"
        >
          Försök återställa sessionen igen
        </button></template
      ></template
    >
    <details class="startup-help">
      <summary>Problem att öppna eller installera appen?</summary>
      <PwaTools />
    </details>
  </section>
</template>
