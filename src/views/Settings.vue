<script setup lang="ts">
import ProfilePicker from '../components/ProfilePicker.vue'
import { backendConfigured } from '../services/supabase'
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
  <section class="panel settings-panel">
    <h2>Appens status</h2>
    <dl>
      <div>
        <dt>Datakoppling</dt>
        <dd>
          {{
            backendConfigured
              ? 'Konfigurerad · säker inloggning återstår'
              : 'Supabase saknar konfiguration'
          }}
        </dd>
      </div>
      <div>
        <dt>Inloggning & synkning</dt>
        <dd>Förbereds i nästa fas</dd>
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
      Privat data cachelagras inte i Phase 0.
    </p>
  </section>
</template>
