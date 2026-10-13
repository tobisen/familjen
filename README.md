# Familjen

Privat, mobilanpassad PWA för en familj. Phase 0 är en fungerande appgrund med tomlägen; kalender, listor, chatt, positioner och push sparar ännu ingen data. Profilnamnen är en uttryckligen begärd del av gränssnittet. Inga aktiviteter, skoluppgifter, positioner eller kontaktuppgifter ingår.

## Lokal utveckling

Node.js 22.22.2 eller senare och npm krävs för den låsta verktygskedjan.

```sh
npm install
cp .env.example .env
npm run dev
```

Öppna URL som Vite visar, normalt `http://localhost:5173/familjen/`. Supabase-variablerna kan vara tomma. Appen visar då att konfigurering saknas. Endast publicerbar Supabase-nyckel får anges i `VITE_*`; dessa värden syns i den byggda klienten.

```sh
npm run lint
npm run typecheck
npm run test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run format` formaterar koden. `npm run preview` visar produktionsbygget. PWA-service worker aktiveras i produktionsbygget. En ny version erbjuder uppdatering; statiska resurser precachas. Privat API-data cachelagras inte. Första besöket kräver nätverk.

## Struktur och tekniska beslut

- `src/views` och `src/components`: svensk, responsiv UI och tillgängliga tomlägen.
- `src/domain`: modeller, lokalt profilval och validerad schemaimport.
- `src/data`: åtkomstgräns för framtida repositories.
- `src/services`: Supabase och browser-API-adaptrar.
- `supabase/migrations`: versionsstyrd SQL med referensintegritet och RLS.
- `docs`: säkerhet, installation och kommande funktioner.

Vue 3, TypeScript, Vite, Vue Router, vite-plugin-pwa, Supabase, Vitest och Playwright. Hash-routing gör direktlänkar och omladdning kompatibla med GitHub Pages utan serveromskrivning. Default base är `/familjen/`; CI härleder basen från repositorynamnet. Vid namnbyte måste Playwrights baseURL och webServer-URL också ändras. För en användarsajt (`owner.github.io`) behövs base `/`. Inga externa typsnitt, kartleverantörer eller betaltjänster krävs. Illustration och ikoner skapas lokalt.

Profil-ID sparas i localStorage. Välj om profil i Inställningar. Detta är en preferens, **inte autentisering**. Alla datafunktioner förblir otillgängliga i Phase 0 även med Supabase-konfiguration.

## Supabase och privat åtkomst

Se [säkerhetsmodell och setup](docs/security.md). Ingen databas skapas automatiskt från appen. Migreringen måste köras i ett eget Supabase-projekt med administrativ behörighet. Inga administrativa nycklar ska läggas i repot, Actions frontend-variabler eller appen.

## GitHub Pages

Workflow `.github/workflows/pages.yml` kör lint, typecheck, enhetstester, build och E2E före publicering från `main`. Pull requests valideras utan publicering. I GitHub: Settings → Pages → Build and deployment → Source: **GitHub Actions**. Tillåt Actions och miljön `github-pages` för main. Om din kontoplan inte erbjuder Pages för privata repositories: publicera en separat granskad frontend utan privat data eller använd tillgänglig privat hosting; gör inte familjedata publika.

Valfria repository variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Utan dem fungerar appskalet. Förväntad URL är `https://tobisen.github.io/familjen/`; se slutrapporten för faktisk verifiering. HTTPS krävs för PWA, push och Geolocation utanför localhost.

## Installera på telefon

iPhone: Safari → Dela → Lägg till på hemskärmen. Android: Chrome-menyn → Installera app/Lägg till på startskärmen. Kontrollera installation på riktiga enheter; automatiska Chromium- och WebKit-tester med mobilviewport ersätter inte installationstest på riktiga telefoner.

## Kommande faser

1. **Phase 1 – familjekalendern:** lösenordsfri autentisering för inbjudna användare, administrativ medlemsregistrering, säkerhetsverifiering, kalender-CRUD, deltagare, realtid och verifierad skolimport.
2. Gemensamma att göra- och inköpslistor med konflikthantering.
3. Chatt och serverstyrda påminnelser/Web Push.
4. Frivillig positionsrapportering i förgrunden med tydlig tidsstämpel och radering.

Se [arkitektur för scheman, push och GPS](docs/architecture.md).
