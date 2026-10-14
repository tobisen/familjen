<script setup lang="ts">
import PushStatus from '../components/PushStatus.vue'
import { ref } from 'vue'
import SchoolImport from '../components/SchoolImport.vue'
const showSchool = ref(false)
import { calendarStatus, syncStatus } from '../stores/calendar'
import { identity, signOut } from '../stores/auth'
import PwaTools from '../components/PwaTools.vue'
import { selectedProfile, profiles } from '../domain/profiles'
import { theme, setTheme } from '../domain/appearance'
import { backendConfigured, configurationError } from '../services/supabase'
import { deviceCapabilities } from '../services/capabilities'
const capabilities = deviceCapabilities()
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">GÖR DIG HEMMA</span>
      <h1>Inställningar</h1>
      <p>Din profil, din enhet och appens status.</p>
    </div>
  </div>
  <section class="panel settings-panel locked-profile">
    <span
      class="avatar"
      :class="
        profiles.find(
          (p) => p.id === (identity?.profile_key ?? selectedProfile),
        )?.color
      "
      >{{
        (identity?.display_name ?? selectedProfile ?? '?')[0]?.toUpperCase()
      }}</span
    >
    <div>
      <h2>{{ identity?.display_name ?? selectedProfile }}</h2>
      <p>Den här enheten är kopplad till din profil.</p>
    </div>
  </section>
  <section class="panel settings-panel">
    <h2>Utseende</h2>
    <div class="tabs" aria-label="Tema">
      <button :aria-pressed="theme === 'dark'" @click="setTheme('dark')">
        Mörkt</button
      ><button :aria-pressed="theme === 'light'" @click="setTheme('light')">
        Ljust
      </button>
    </div>
  </section>
  <RouterLink class="secondary-button" to="/karta">Familjekarta</RouterLink>
  <p v-if="configurationError" role="alert" class="notice">
    {{ configurationError }}
  </p>
  <section class="panel settings-panel">
    <h2>Appens status</h2>
    <dl>
      <div>
        <dt>Datakoppling</dt>
        <dd>
          {{
            backendConfigured ? 'Konfigurerad' : 'Supabase saknar konfiguration'
          }}
        </dd>
      </div>
      <div>
        <dt>Kalender & synkning</dt>
        <dd>
          {{
            calendarStatus === 'ready'
              ? syncStatus
              : 'Kalendern är inte ansluten'
          }}
        </dd>
      </div>
      <div>
        <dt>Pushnotiser</dt>
        <dd>
          {{
            capabilities.push
              ? 'Se enhetens behörighetsstatus nedan'
              : 'Stöd saknas i den här webbläsaren'
          }}
        </dd>
      </div>
      <div>
        <dt>Platsdelning</dt>
        <dd>
          {{
            capabilities.geolocation
              ? 'GPS används när appen är aktiv och tillstånd finns'
              : 'Stöd saknas'
          }}
        </dd>
      </div>
    </dl>
  </section>
  <section class="panel settings-panel">
    <h2>Din registrering</h2>
    <p v-if="identity">
      Registrerad som {{ identity.display_name }}. Profilval i lokal lagring kan
      inte ändra denna identitet.
    </p>
    <p v-else>En personlig registrering krävs innan familjedata kan hämtas.</p>
    <button v-if="identity" class="secondary-button" @click="signOut">
      Logga ut den här enheten
    </button>
  </section>
  <section class="panel settings-panel">
    <h2>Skolscheman</h2>
    <p>
      Förhandsgranska och korrigera Sallys och Neos schema, hantera terminer,
      lov och importstatus.
    </p>
    <button
      class="secondary-button"
      :disabled="!identity"
      @click="showSchool = true"
    >
      Hantera skolscheman
    </button>
  </section>
  <SchoolImport v-if="showSchool" @close="showSchool = false" />
  <PushStatus />
  <PwaTools />
  <section class="panel settings-panel">
    <h2>Installera Familjen</h2>
    <p>
      iPhone: öppna appen i Safari, välj Dela och Lägg till på hemskärmen.
      Android: välj Installera app eller Lägg till på startskärmen i
      webbläsarens meny.
    </p>
    <p class="small">
      Push på iPhone kräver iOS 16.4 eller senare, installerad PWA och ett
      aktivt val att tillåta notiser. Behörighet begärs när du väljer Aktivera
      notiser.
    </p>
    <p class="small">
      Appens statiska resurser sparas för offlinebruk efter första laddningen.
      Kalenderdata lagras inte i offline-cache.
    </p>
  </section>
</template>
