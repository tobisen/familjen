# Familjen

Mobilanpassad PWA för Tobias, Neo och Sally med privat familjekalender, att göra-lista, inköpslista och familjechatt. Listorna stöder flera ansvariga, återkomst, köphistorik och Supabase Realtime. [Phase 2: funktioner, säkerhet och verifiering](docs/phase2.md).

**Phase 1.5:** kalendern är åter privat. En personlig engångskod registrerar enheten; därefter sparas sessionen utan återkommande lösenord. Lokal profil är en preferens, inte autentisering. Anonym åtkomst och de gamla publika RPC:erna är borttagna. [Aktuell setup](docs/phase1-setup.md).

[Installation, engångskoder och starthjälp](docs/installation.md). Registreringssida: https://tobisen.github.io/familjen/register/.

## Lokal utveckling

Node.js 22.22.2 eller senare och npm. CI använder Node 24.

```sh
npm install
cp .env.example .env
npm run dev
```

Öppna normalt `http://localhost:5173/familjen/`. Det separata Familjen-projektets offentliga klientkonfiguration finns i `config/public-supabase.json`. Appen kräver personlig registrering för familjedata. `VITE_SUPABASE_DISABLED=true` startar ett isolerat appskal utan backend. Vinskåpets databas och nycklar återanvänds aldrig.

```sh
npm run lint
npm run typecheck
npm run test
npm run build
npx playwright install chromium webkit
npm run test:e2e
npm run test:e2e:calendar
```

`npm run format` formaterar. `npm run preview` visar produktionsbygget. Phase 0-regression bygger separat `dist-shell/` utan nätbackend så att tester aldrig skriver till en riktig kalender. Kalender-E2E använder separat `dist-e2e/`, en fiktiv URL och riktiga migrationer i PGlite via testets HTTP-adapter. Ingen testbackend eller testdata inkluderas i produktionsbygget. Det verifierar UI och SQL tillsammans, men ersätter inte ett integrationstest med riktig Supabase/PostgREST/Realtime.

## Supabase-installation

Följ [Phase 1 setup](docs/phase1-setup.md). De elva migrationerna är körda i det separata projektet; vid ny miljö körs alla i ordning. Den gamla offentliga kalendern är avvecklad av migration 003. Den publika konfigurationsfilen används redan av Pages; `.env` och repository variables är valfria overrides. Ingen `service_role`, `sb_secret_*`, databaslösenord eller administrativ nyckel får finnas i frontend eller `VITE_*`.

## Kalendern

- Tobias blå, Neo grön, Sally orange. Alla aktiviteter visas samtidigt; deltagarfilter och kategorier kombineras.
- Tryck på plus eller en tom timme för att skapa. Profilen är förvald som deltagare. Tryck på aktivitet för detaljer, ändring, undantag eller bekräftad radering.
- Daglig, veckovis och månadsvis återkomst, intervall 1–52, valfritt slutdatum och undantagsdatum. Redigering gäller hela serien; enstaka tillfällen kan undantas.
- Tider visas i Europe/Stockholm även när telefonen använder en annan tidszon. Händelser lagras som timestamptz. Återkomst följer svensk lokal klocktid.
- Heldag inkluderar valt slutdatum. Intern sluttid är exklusiv midnatt nästa dag.
- Månatlig serie på den 31:a hoppar över månader utan den dagen. Vårens saknade timme hoppas över i serier, höstens dubbla timme använder första förekomsten. Vid manuell inmatning krävs ett uttryckligt val för dubbel hösttimme; obefintlig vårtid avvisas.
- Optimistisk versionskontroll förhindrar tysta överskrivningar. Vid konflikt: öppna aktiviteten på nytt. Realtime uppdaterar kalendern; återanslutning/förgrund laddar om aktuella data.
- Statiskt appskal fungerar offline efter första nätbesöket. Kalenderdata lagras inte i offline-cache; ändringar kräver nätverk.

## Skolscheman

[Importformat och arbetssätt](docs/school-import.md). Förhandsgranska lokal JSON och bekräfta uppgifter/publicering innan någon lektion skickas till Supabase. Veckovis giltighet från valt startdatum, med bekräftad terminsstart och terminsslut. Import blockeras om något datum saknas. Lov/studiedagar hanteras som undantagsdatum.

Faktiska underlag ligger lokalt i git-ignorerade `private-imports/`, aldrig i `public/`, `src/` eller publikt Git-repo. Sallys 24 användarangivna lektioner är transkriberade utan gissade salar eller terminsdatum. Neos mall är tom eftersom källbilden saknas i aktuell kontext. Inga scheman importeras automatiskt.

## GitHub Pages och PWA

[Pixel 7: WebAPK redan installerad men kan inte öppnas](docs/android-webapk.md). PWA-identiteten behålls; webbcache och Androids paketregistrering hanteras separat.

[Publicerad app](https://tobisen.github.io/familjen/). `.github/workflows/pages.yml` validerar och publicerar från main. Settings → Pages → Source: GitHub Actions. Lägg valfria repository variables `VITE_SUPABASE_URL` och `VITE_SUPABASE_PUBLISHABLE_KEY` för det separata projektet. Utan overrides används projektets publika konfigurationsfil; administrativa nycklar avvisas vid build.

Hash-routing fungerar utan serveromskrivning. CI härleder base från repositorynamnet. Vid namnbyte behöver också testernas URL:er justeras. Användarsajt `owner.github.io` kräver base `/`. HTTPS krävs för PWA och framtida push/GPS.

iPhone: Safari → Dela → Lägg till på hemskärmen. Android: webbläsarmenyn → Installera app/Lägg till på startskärmen. Push kräver på iOS 16.4+ en installerad PWA och aktivt godkännande. Push och platsdelning är ännu inte aktiverade; ingen bakgrunds-GPS utlovas.

## Arkitektur och arbetsmetod

Vinskåpets arbetsmetod återanvänds: rena testbara domänfunktioner, separat repository, reaktiv store, enda Supabase-klient och verifiering före publicering. Ingen databaskoppling, seed, säkerhetsnyckel eller auth-session delas med Vinskåpet.

- `src/domain`: tidszon, återkomst, deltagarfilter, importvalidering och modeller.
- `src/data/calendarRepository.ts`: Supabase RPC och Realtime-adapter.
- `src/stores/calendar.ts`: data, fel/laddning, mutationer och synkning.
- `src/views`, `src/components`: UI.
- `supabase/migrations`: privat familjekalender med serveridentitet och skyddad Phase 0-modell.
- `tests/support`: isolerad SQL-testmiljö; aldrig importerad av appen.

## Verifiering av riktig synk

Riktig registrering, två separata sessioner, Realtime, återanslutning och hosted RLS har verifierats. Se [Phase 1.5 verifieringsrapport](docs/phase1.5-verification.md). Personliga engångskoder utfärdas med `python3 scripts/create-device-codes.py` efter publicering; filer under `private-registration/` får aldrig delas publikt.

[Phase 3: chatt, lässtatus, säkerhet och pusharkitektur](docs/phase3.md).

## Fortsättning

Phase 4 är implementerad med serverstyrd köhantering, mottagarval och VAPID-hemligheter i Edge Functions. Frivillig GPS-delning följer senare. [Tidigare arkitektur för push/GPS](docs/architecture.md) gäller fortsatt för dessa funktioner.

[Phase 3.1: privat schemaadministration, officiella datumkällor och aktiveringsstatus](docs/phase3.1-school-schedules.md). Sallys 24 veckoposter inklusive fem luncher är aktiverade för HT 2026 och VT 2027. Höstens slutdatum 22 december är tydligt markerat preliminärt; vårterminens gränser är verifierade för årskurs 1. Neos 18 preliminära poster finns privat i Supabase men inväntar verifierade sluttider. Datum och undantag kan uppdateras i Inställningar → Hantera skolscheman.

[Phase 4: pushnotiser, påminnelser och drift](docs/phase4-push.md). Serverstyrd kö, VAPID, Edge Function och minutjobb är konfigurerade. Aktivera telefonens behörighet i appen och prova Skicka testnotis. Fysisk Android-/iPhone-leverans återstår att verifiera. Nästa uppdrag är Phase 5 – Familjekarta och GPS.
