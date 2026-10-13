<script setup lang="ts">
import { calendarStatus, syncStatus } from '../stores/calendar'
import { identity, signOut } from '../stores/auth'
import PwaTools from '../components/PwaTools.vue'
import ProfilePicker from '../components/ProfilePicker.vue'
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
  <div class="panel settings-panel"><ProfilePicker /></div>
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
              ? 'Webbläsarstöd finns · inte aktiverat'
              : 'Stöd saknas i den här webbläsaren'
          }}
        </dd>
      </div>
      <div>
        <dt>Platsdelning</dt>
        <dd>
          {{
            capabilities.geolocation
              ? 'Webbläsarstöd finns · inte aktiverat'
              : 'Stöd saknas'
          }}
        </dd>
      </div>
    </dl>
  </section>
  <section class="panel settings-panel">
    <h2>Privat familjekalender</h2>
    <p v-if="identity">
      Registrerad som {{ identity.display_name }}. Profilval i lokal lagring kan
      inte ändra denna identitet.
    </p>
    <p v-else>En personlig registrering krävs innan familjedata kan hämtas.</p>
    <button v-if="identity" class="secondary-button" @click="signOut">
      Logga ut den här enheten
    </button>
  </section>
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
      aktivt val att tillåta notiser. Funktionen är ännu inte implementerad.
    </p>
    <p class="small">
      Appens statiska resurser sparas för offlinebruk efter första laddningen.
      Kalenderdata lagras inte i offline-cache.
    </p>
  </section>
</template>
