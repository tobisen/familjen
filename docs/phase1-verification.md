# Phase 1 verifiering – 2026-10-13

## Lokalt verifierat

- Node 24, låsta npm-beroenden. Installation av Temporal lyckades; npm rapporterade 0 sårbarheter vid installationen.
- Lint/Prettier, TypeScript och produktionsbuild passerar utan Supabase-nycklar.
- **54 enhetstester**: Phase 0-regression, kalenderlogik, veckostart/månad, deltagarfilter, heldag och överlapp, daglig/veckovis/månadsvis återkomst, slutdatum/undantag, Stockholmstid och båda DST-övergångar, importvalidering, publika nycklar och Realtime-adaptern.
- Båda SQL-migrationerna körs i PGlite/PostgreSQL. Tester verifierar aktiveringskrav, avsiktligt offentlig CRUD, versionskonflikter, atomisk import/upsert, rollback, neka direkt tabellskrivning och fortsatt skydd av privata Phase 0-tabeller.
- **6 kalender-E2E**: skapa/ändra/radera, flera deltagare, filtrering, dag/vecka/månad, läsning från separat webbläsarsession, återladdning, importförhandsgranskning/bekräftelse/dubbletter, skapa från tom tid, heldagsserie och enstaka undantag. Chromium/Pixel 7 och WebKit/iPhone 13.
- **4 Phase 0-E2E**: profilpreferens, återställning/profilbyte, alla routes, konfigurationsstatus, PWA-manifest och statisk offline-start, i samma två motorer.
- Mobilkalender visuellt kontrollerad och kontrollerna komprimerade för att ge tidsaxeln utrymme.
- Verifierat att Sallys/Neos faktiska underlag är git-ignorerade och inte finns i appens källor/public-katalog eller produktionsbygge.

Kalender-E2E använder riktiga SQL-funktioner/RLS i lokal PGlite via en testspecifik HTTP-adapter. Den är ingen produktionsmock och ingår aldrig i appen. Den verifierar inte hosted Supabase Auth, PostgREST eller WebSocket-protokoll. Regression och kalender-E2E bygger i separata kataloger från den publicerade `dist/` för att aldrig använda/mutera en riktig backend.

## Externa blockerare och kvarvarande kontroller

Ingen separat Supabase-anslutning, projekt-URL eller publishable key är tillgänglig i denna miljö. Därför har inget Supabase-projekt skapats, inga migrationer körts där, inga skolscheman publicerats och ingen riktig tvåtelefonssynkning verifierats. Realtime har adaptertester; dess hosted end-to-end-verifiering återstår. Supabase-setup finns i `phase1-setup.md`.

Neos källbild saknas; underlaget är en tom kompletteringsmall. Sallys underlag har 24 användarangivna lektioner men inga gissade salar, startdatum, terminsdatum eller lov. Veckovis giltighet tills manuell uppdatering följer senare användarbeslut. Publiceringsbekräftelse och startdatum krävs vid import.

Kalendern är avsiktligt offentlig även för redigering, enligt uttryckligt senare användarbeslut. Privat autentisering är därför inte ett aktuellt acceptanskriterium för kalendern; det är fortfarande ett krav innan framtida privata funktioner aktiveras. Installation på fysiska iPhone/Android behöver slutkontrolleras.

Commit, CI och Pages-status redovisas efter faktisk publiceringsverifiering i slutrapporten; denna fil gör inget förhandsantagande om deployment.
