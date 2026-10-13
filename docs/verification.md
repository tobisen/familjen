# Phase 0 – lokal verifiering 2026-10-13

Verifierat på macOS med Node 24 och låsta npm-beroenden:

- `npm install` samt ren `npm ci`: lyckades. Beroendegranskningen vid installation rapporterade 0 sårbarheter.
- `npm run lint`: godkänt, inklusive Prettier.
- `npm run typecheck`: godkänt.
- `npm run test`: 20 tester godkända. Profilpreferens och schemaformat samt SQL-migration/RLS i PGlite/PostgreSQL med emulerad Supabase Auth.
- `npm run build`: godkänt utan Supabase-nycklar, manifest och service worker genereras under `/familjen/`.
- `npm run test:e2e`: 4 tester godkända i Chromium (Pixel 7) och WebKit (iPhone 13). Profilval, återställning, profilbyte, samtliga vyer, dialog, responsiv bredd, manifest och offline-omladdning verifieras.
- Mobil- och desktop-layout visuellt kontrollerade från produktionsbygget.
- RLS-tester omfattar nekad anonym åtkomst för samtliga tabeller, icke-medlem, separata familjer, spärrad medlemsadministration, korskopplade foreign keys, positionsägare, privata pushendpoints och skolupsert utan dubbletter.

Inte verifierat utan externa resurser: Supabase Auth/magic links med riktiga identiteter, RLS med verkliga JWT, Realtime, pushleverans, GPS-delning och PWA-installation på fysiska telefoner. Dessa funktioner är förberedda och tydligt inaktiva. Publiceringsstatus rapporteras separat efter push; denna fil påstår inte att GitHub Actions har körts.
