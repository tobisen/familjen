<script setup lang="ts">
import { ref } from 'vue'
import { profiles, type ProfileId } from '../domain/profiles'
import { registerWithCode, authBusy } from '../stores/auth'
const profile = ref<ProfileId>('tobias')
const code = ref('')
async function submit() {
  const value = code.value
  code.value = ''
  await registerWithCode(profile.value, value)
}
</script>
<template>
  <form class="code-registration" @submit.prevent="submit">
    <fieldset>
      <legend>Vem loggar in?</legend>
      <label
        v-for="p in profiles"
        :key="p.id"
        class="person-chip"
        :class="p.color"
        ><input
          v-model="profile"
          type="radio"
          name="registration-profile"
          :value="p.id"
        />{{ p.name }}</label
      >
    </fieldset>
    <label
      >Personlig kod<input
        v-model="code"
        autocomplete="current-password"
        autocapitalize="characters"
        spellcheck="false"
        placeholder="XXXX-XXXX-XXXX-XXXX"
        minlength="16"
        maxlength="32"
        required
    /></label>
    <p class="small">
      Koden gäller din profil och kan återanvändas. Den har ingen tidsgräns och
      gäller tills Tobias uttryckligen byter den.
    </p>
    <button class="primary-button" :disabled="authBusy">
      {{ authBusy ? 'Registrerar…' : 'Logga in med personlig kod' }}
    </button>
  </form>
</template>
