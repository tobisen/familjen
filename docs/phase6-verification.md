# Phase 6 – verifiering 2026-11-22

## Leverans

Min vecka är isolerad från kalender, listor, chatt, GPS och push. Serverstyrd
behörighet använder Tobias befintliga stabila profil och Auth-koppling. De fyra
huvudflikarna behålls; den privata ikonen ligger intill profilen.

Migration `202611220001_personal_weeks.sql` kördes atomärt i Familjens befintliga
Supabase-projekt och registrerades i `supabase_migrations.schema_migrations`.
Den skapar fyra planeringstabeller och en adminstyrd behörighetstabell.
Inga nya Auth-användare behövdes.

## Resultat

- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`: godkända
  med Node 24. Samtliga 209 tester i 33 filer passerar. PostgreSQL/WASM-testerna
  begränsas till två workers efter reproducerade resursrelaterade tidsgränsfel
  vid obegränsad parallellism.
- Hela kalender-/familjesviten: 70 godkända mobiltester i Chromium och WebKit.
  Efter ytterligare ett testfall kördes samtliga 14 Phase 6-mobiltester om,
  inklusive återställning av checkbox vid sparfel och bekräftad sparning före
  omladdning. Alla passerar. GitHub Actions kör hela den slutliga sviten.
- Befintliga appskal-/PWA-tester: 20 godkända i Chromium och WebKit.
- Mobilvy visuellt granskad, utan horisontell överströmning vid 320 px och
  ordinarie Pixel 7-/iPhone-bredd. Dagar kan fällas ihop; tomma kategorier och
  sammanfattningsfält tar inte plats.
- ISO-vecka 53, 2026 → vecka 1, 2027, felaktiga datum och veckodagar,
  markörer, kategorier, storleksgränser och saknade valfria fält verifierade.
- Dubbletter, idempotenta återförsök, stabila redigerings-ID:n, versionskonflikt,
  atomär rollback efter sent valideringsfel och förfalskade relationer verifierade
  med de riktiga SQL-migrationerna i PGlite.

## Riktig Supabase och identiteter

`scripts/live-personal-week.mjs` kördes via den publika klientkonfigurationen
med riktiga tillfälliga sessioner för Tobias, Neo och Sally. Administrativ
provisionering använde endast befintliga identiteter; nycklar och sessionsdata
skrevs inte till frontend, Git eller loggar.

Verifierat mot PostgREST:

- Tobias kan skapa, läsa och redigera en privat vecka och bocka av uppgifter.
- Samma import-request kan återförsökas utan dubbletter. Ny import av befintlig
  vecka utan versionsbekräftelse nekas.
- Misslyckad ersättning behåller föregående version och avbockningar.
  Bekräftad ersättning behåller veckans ID och ersätter innehållet atomärt.
- Neo och Sally får ingen privat behörighet, tomma resultat vid direkta SELECT
  på samtliga fyra planeringstabeller och nekas både snapshot och save-RPC.
- Direkt INSERT/UPDATE/DELETE nekas alla tre, även ägaren, enligt RPC-mönstret.
- Förfalskat owner_id och gammalt versionsnummer nekas av servern.

Testets fiktiva framtidsvecka raderades efteråt och testsessionerna återkallades.
Ett första operatörsförsök stoppades av lokala Node 20 utan WebSocket-stöd;
slutlig verifiering använde Node 24, som matchar CI. Inga telefon- eller
PWA-sessioner återkallades.

## Begränsningar

Fysiska telefoner har inte använts för denna fas. Offline-redigering och en
särskild Realtime-kanal för privata veckor ingår inte. Supabase är sanningskälla;
veckan hämtas vid navigation, omladdning och återgång till fönstret när ingen
dialog är öppen. Samtidig redigering skyddas med versionskontroll.
