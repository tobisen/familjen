<script setup lang="ts">
import { identity } from '../stores/auth'
import { profiles, selectProfile, selectedProfile } from '../domain/profiles'
defineProps<{ initial?: boolean }>()
</script>
<template>
  <section :class="{ onboarding: initial }" aria-labelledby="profile-title">
    <span class="eyebrow">VÅR PLATS I VARDAGEN</span>
    <h1 id="profile-title">
      {{ initial ? 'Välkommen till Familjen.' : 'Vem använder appen?' }}
    </h1>
    <p>Välj din profil för att göra appen personlig.</p>
    <div class="profile-options">
      <button
        v-for="p in profiles"
        :key="p.id"
        :aria-pressed="selectedProfile === p.id"
        :disabled="Boolean(identity) && identity?.profile_key !== p.id"
        @click="selectProfile(p.id)"
      >
        <span class="avatar" :class="p.color">{{ p.name[0] }}</span
        >{{ p.name }}<span v-if="selectedProfile === p.id">✓</span>
      </button>
    </div>
    <p class="small">
      Din registrerade identitet bestäms säkert av servern. En annan persons
      profil kräver den personens registrering; lokal profilväxling ger ingen
      annan behörighet.
    </p>
  </section>
</template>
