# Registrering och PWA – korrigering

## Fynd och ändringar

Det rapporterade Android-felet har inte reproducerats på fysisk telefon. Koden visade flera brister i återhämtning: inget uttryckligt manifest-ID, ingen fristående starthjälp, ingen fysisk `/register/`-sida på Pages och en uppdateringsknapp som doldes när autentiseringsgrinden visades. Dessa fynd bevisar inte vilken av dem som orsakat den gamla Android-installationens fel.

Manifestets uttryckliga ID är `/familjen/`, samma som det tidigare implicita ID:t från start_url. Identiteten byts alltså inte. Start/scope/ikoner är absoluta under repositorybasen. Hash-routing behålls för interna vyer, och byggsteget skapar riktiga HTML-filer för `/register/` och `/recover/` utan krav på serveromskrivningar. Återställningssidan undantas från appskalets navigation fallback.

Workbox använder appens cacheprefix och versionshashar, gammal precache städas vid aktivering, uppdatering efterfrågas vid förgrund/återkomst och aktiveras med användarens knapp. Registrering och familjedata nätcachas aldrig. Ett fristående boot-script visar starthjälp även vid trasigt appbundle; chunk-fel får högst ett automatiskt omladdningsförsök. Cacheåterställning tar bara bort denna appscopes worker och cache, aldrig Auth-lagring, cookies eller IndexedDB. Autentiseringskontroller har tidsgräns; giltig lagrad session raderas inte vid tillfälligt nätfel.

## Registreringssäkerhet

Migration 004 skapar privata hashar, giltighet och försökslogg med RLS och utan webbläsarbehörigheter. Bara service_role kan anropa konsumtions-RPC:n. Edge Function är publik för registrering före Auth, men kräver personlig 80-bitarskod och konsumerar den atomiskt under databaslås. Profilkoppling härleds från den befintliga adminstyrda profilen. Samma fel lämnas för felaktig, utgången och använd kod. Spärr per profil och IP begränsar upprepade försök. Sessioner kommer från riktig Supabase Auth och befintliga användar-ID:n bevaras. Äldre registreringslänkar stöds fortsatt.

Migrationen är körd och Edge Function driftsatt i projekt `mulsuwdmpixzukzwpocf`. Ingen administrativ nyckel har lagrats i frontend eller Git.

## Verifiering före publicering

- Lint, TypeScript och produktionsbuild passerar.
- 68 enhetstester passerar, inklusive verklig migrations-SQL i PGlite: privat kodåtkomst, rätt profil, engångsbruk, felaktig/utgången kod, tidsfönster och försöksbegränsning.
- 22 E2E passerar i Chromium och WebKit med mobil viewport: manifest/sökvägar, uppstart, trasigt bundle, cacheåterställning, session efter omladdning, kodfel, utgången session, kalender-CRUD, schemaimport och återkomst.
- Riktig driftsatt Edge Function/Supabase: felaktig kod, utgången kod, fel profil, två samtidiga försök med samma kod (exakt ett lyckas), signerad session med rätt serveridentitet och nekad återanvändning verifierade. Endast testets egna tillfälliga kodrader städades. Produktionens försökslogg raderades inte.

Automatiserade motor-/viewporttester är inte fysisk verifiering av Android WebAPK, Chrome-installationsdialog eller iOS hemskärmsinstallation. Installation/start på användarens telefon återstår. Följ [installationsguiden](installation.md), särskilt avinstallation av en kvarvarande trasig Android-installation.

`scripts/live-pwa-update.mjs` kan verifiera en verklig uppdatering från föregående Pages-version med en riktig session. Indata och engångstoken skickas enbart via stdin; sessioner skrivs inte i logg. Kör före publicering och låt processen följa publiceringen.
