# Familjen

Mobilanpassad PWA för Tobias, Neo och Sally. Phase 1 implementerar gemensam kalender med dag-, vecko- och månadsvy, CRUD, deltagare, heldag, återkommande serier, undantag, schemaimport och Supabase Realtime.

**Ändrat säkerhetsbeslut 2026-10-13:** användaren har uttryckligen valt att kalendern får vara offentlig för både läsning och redigering. Profilvalet är därför en lokal preferens, inte autentisering. Alla med webbadressen kan läsa, skapa, ändra och radera kalenderdata när administratören har aktiverat den. Inga inloggningskoder eller lösenord används för kalendern. Framtida chatt, GPS, listor och push ligger kvar i separat, skyddad Phase 0-modell. Öppna aldrig dessa tabeller för att få kalendern att fungera.

## Lokal utveckling

Node.js 22.22.2 eller senare och npm. CI använder Node 24.

```sh
npm install
cp .env.example .env
npm run dev
```

Öppna normalt `http://localhost:5173/familjen/`. Appen startar utan Supabase-konfiguration och visar tydligt att aktiviteter inte kan hämtas/sparas. Med konfiguration används enbart ett **eget, separat Familjen-projekt**; Vinskåpets databas och nycklar återanvänds aldrig.

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

Följ [Phase 1 setup](docs/phase1-setup.md). Kör båda migreringarna i ordning. Den offentliga kalendern är avstängd som standard och aktiveras administrativt. `.env` och GitHub repository variables behöver projektets publika URL och publicerbara nyckel. Ingen `service_role`, `sb_secret_*`, databaslösenord eller administrativ nyckel får finnas i frontend eller `VITE_*`.

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

[Importformat och arbetssätt](docs/school-import.md). Förhandsgranska lokal JSON och bekräfta uppgifter/publicering innan någon lektion skickas till Supabase. Veckovis giltighet från valt startdatum, med valfritt slutdatum; tomt slutdatum innebär tills manuell uppdatering enligt användarens senare instruktion. Lov/studiedagar hanteras som undantagsdatum.

Faktiska underlag ligger lokalt i git-ignorerade `private-imports/`, aldrig i `public/`, `src/` eller publikt Git-repo. Sallys 24 användarangivna lektioner är transkriberade utan gissade salar eller terminsdatum. Neos mall är tom eftersom källbilden saknas i aktuell kontext. Inga scheman importeras automatiskt.

## GitHub Pages och PWA

[Publicerad app](https://tobisen.github.io/familjen/). `.github/workflows/pages.yml` validerar och publicerar från main. Settings → Pages → Source: GitHub Actions. Lägg valfria repository variables `VITE_SUPABASE_URL` och `VITE_SUPABASE_PUBLISHABLE_KEY` för det separata projektet. Utan dem publiceras ett fungerande appskal med tydlig konfigurationsstatus.

Hash-routing fungerar utan serveromskrivning. CI härleder base från repositorynamnet. Vid namnbyte behöver också testernas URL:er justeras. Användarsajt `owner.github.io` kräver base `/`. HTTPS krävs för PWA och framtida push/GPS.

iPhone: Safari → Dela → Lägg till på hemskärmen. Android: webbläsarmenyn → Installera app/Lägg till på startskärmen. Push kräver på iOS 16.4+ en installerad PWA och aktivt godkännande. Push och platsdelning är ännu inte aktiverade; ingen bakgrunds-GPS utlovas.

## Arkitektur och arbetsmetod

Vinskåpets arbetsmetod återanvänds: rena testbara domänfunktioner, separat repository, reaktiv store, enda Supabase-klient och verifiering före publicering. Ingen databaskoppling, seed, säkerhetsnyckel eller auth-session delas med Vinskåpet.

- `src/domain`: tidszon, återkomst, deltagarfilter, importvalidering och modeller.
- `src/data/calendarRepository.ts`: Supabase RPC och Realtime-adapter.
- `src/stores/calendar.ts`: data, fel/laddning, mutationer och synkning.
- `src/views`, `src/components`: UI.
- `supabase/migrations`: separat offentlig kalender och oförändrad privat Phase 0-modell.
- `tests/support`: isolerad SQL-testmiljö; aldrig importerad av appen.

## Fortsättning

Phase 2 – att göra och inköpslista. Bestäm dessa funktioners sekretess uttryckligen innan datalager aktiveras; kalenderns offentliga behörighet gäller bara kalendern. Chatt, push/påminnelser och frivillig GPS-delning följer senare. [Tidigare arkitektur för push/GPS](docs/architecture.md) gäller fortsatt för dessa funktioner.
