# Phase 1.5 – verifiering 2026-10-13

## Separat verkligt Supabase-projekt

Projekt `familjen`, ref `mulsuwdmpixzukzwpocf`, Stockholm `eu-north-1`, skapat på verifierad gratisplan. Befintlig kontoinloggning användes via CLI-profilen `supabase`; inget projekt, någon projekt-nyckel eller session från Vinskåpet kopierades. Migrationerna 001, 002 och 003 är tillämpade och journalförda. Auth sign-up och anonymous sign-ins är avstängda. Interna personliga enhetsidentiteter är administrativt kopplade till rätt profiler.

## Riktig tvåsessionstestning – passerad

Produktionsbygget kördes med projektets publika klientnyckel mot hosted Supabase, utan HTTP/WebSocket-mockar. Två isolerade Chromium-kontexter registrerades med riktiga engångslänkar som Tobias och Sally:

- registrering, serverbestämd profil och bestående session efter omladdning,
- skapa från Tobias, synligt hos Sally via Realtime utan omladdning,
- redigera från Sally, uppdaterat hos Tobias via Realtime,
- offline i Sallys session, ändring från Tobias, återanslutning och aktuell data + återetablerad Realtime,
- radering från Sally, borttaget hos Tobias via Realtime,
- förfalskat lokalt profilval ignoreras; Sally förblir Sally efter omladdning,
- utloggning stänger privat UI och kanaler,
- anonym HTTP-klient nekas alla 14 familjetabeller och fem huvudsakliga kalender-RPC:er.

`scripts/live-sync.mjs` tar bara temporära indata via stdin och loggar aldrig token/länkar. Testdata är syntetiska och markeras/raderas. Sessioner och refresh tokens skickas aldrig till frontendbygget eller Git.

## Riktig RLS-verifiering – passerad

Med hosted Supabase Auth och PostgREST skapades kortlivade testidentiteter för en icke-medlem och en annan familj. Testresurserna togs bort efteråt:

- icke-medlem ser inga rader i någon av de 14 familjetabellerna,
- icke-medlem nekas snapshot/save/delete/import,
- annan familj kan inte läsa, uppdatera eller radera Familjens aktivitet,
- serverstyrt familje-ID och författare kan inte förfalskas i payload,
- klienten kan inte uppdatera sin profilkoppling,
- faktisk PostgreSQL-katalog visar RLS på alla 14 tabeller och inga anon SELECT/INSERT/UPDATE/DELETE-grants,
- gamla publika RPC:er är borttagna; nya RPC:er kräver autentisering och provisionerad familj.

`scripts/live-rls.mjs` använder verkliga JWT/API-anrop och får temporära credentials via stdin. Lokala SQL-tester verifierar även alla RPC/helper-execute-rättigheter, versionskonflikter, deltagare, full rollback och medlemsåterkallning.

## Lokal verktygskedja

62 enhetstester omfattar Phase 0, kalender/DST, privat SQL/RLS, schemaimport, återställning av Auth, utloggning, sena svar efter logout, registreringsfragment och publika klientnycklar. Mobil-E2E omfattar Chromium och WebKit, separat verklig SQL via testadapter och ett isolerat backendfritt PWA-shell. Lint/typecheck/build och fulla E2E körs även av CI före Pages-publicering.

Den lokala HTTP-adaptern är inte bevis för hosted synk; det separata riktiga testet ovan är det. Fysiska iPhone/Android och installationens eventuellt separata browserlagring är inte testade i denna miljö.

## Skolscheman och kvarvarande manuella steg

Sallys 24 användarangivna poster, inklusive fem luncher, är granskade: dagantal 5/4/5/5/5, giltiga tidsintervall och inga överlapp. Terminsdatumen är fortfarande obekräftade. Databasen innehåller **0 skolrader**; ingen import kördes. Neos separat JSON-underlag är tomt eftersom källbilden saknas; inga tider uppskattades.

Personliga oanvända registreringslänkar utfärdas efter publiceringen i lokala git-ignorerade HTML-filer under `private-registration/`, katalog 0700/filer 0600. Användaren behöver öppna rätt länk på respektive enhet. Länkar är tidsbegränsade och engångsbruk; de kan förnyas lokalt med `python3 scripts/create-registration.py` på en dator med den rätta CLI-kontoinloggningen. Inga administrativa nycklar finns i dessa filer.

Commit och faktisk CI/Pages-status redovisas i slutrapporten efter verifiering.
