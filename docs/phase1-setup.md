# Supabase – aktuell setup i Phase 1.5

Phase 1:s offentliga kalender är ersatt av en privat kalender. Kör aldrig tidigare instruktioner för att aktivera offentlig åtkomst. Migration `202610130003_private_calendar.sql` tar bort de publika RPC:erna och anonym åtkomst; lokal profil är inte autentisering.

## Projekt

- Separat Supabase-projekt **familjen**, ref `mulsuwdmpixzukzwpocf`, region Stockholm `eu-north-1`.
- Skapat i befintlig organisation efter verifiering av gratisplanen och ledig projektplats. Vinskåpets databas, nycklar och sessioner används inte.
- Kontoinloggningen återanvändes via Supabase CLI:s namngivna profil `supabase` i OS credential store. Administrativa nycklar har hanterats endast i processminnet, inte lagrats i repo/frontend.
- De fem migrationerna är tillämpade i ordning och journalförda i `supabase_migrations.schema_migrations`.
- `config/public-supabase.json` innehåller endast projekt-URL och offentlig **anon**-nyckel. Den får vara publik; RLS och RPC-behörigheter skyddar all familjedata. Vite validerar att nyckeln är publishable/anon och avvisar administrativa nycklar. Miljövariabler kan ersätta dessa publika värden; `VITE_SUPABASE_DISABLED=true` stänger backend i det isolerade shell-testet.

## Registrera en enhet

**Aktuellt flöde:** välj namn och personlig engångskod på `/familjen/register/`. Se [installation och kodutfärdande](installation.md). Migration 004 och Edge Function `register-device` är driftsatta. Äldre engångslänkar stöds fortsatt, liksom alla redan registrerade sessioner. Nedanstående beskriver det kompatibla äldre länkflödet.

1. En administratör provisionerar identiteten i Supabase Auth och binder `auth.users.id` till rätt rad i `profiles.auth_user_id`. Profilens `profile_key` är `tobias`, `neo` eller `sally` och är administrativt styrd. Slutanvändare får inte skapa/ändra detta medlemskap.
2. Administratören genererar en kortlivad engångslänk med Supabase Auth Admin `generateLink(type: magiclink)`. `hashed_token` läggs i URL-fragmentet `#/registrera?token_hash=…&type=magiclink`. Fragmentet skickas inte till GitHub Pages. Appen tar bort det från adressfältet innan navigation.
3. Användaren öppnar sin personliga länk på avsedd enhet och väljer **Registrera den här enheten**. Supabase verifierar token med `verifyOtp`; först därefter hämtas serveridentitet och privat kalender. Token är personlig, engångsbruk och tidsbegränsad. En använd länk kan inte återanvändas för att registrera en annan enhet.
4. Auth-sessionen sparas av Supabase SDK och förnyas automatiskt. Appen återställer rätt serverprofil efter omladdning. Lagring kan rensas av användaren/webbläsaren eller administratören återkalla sessionen; då behövs ny registrering. Det är inte en garanti om permanent inloggning.
5. För ett annat konto på samma enhet: logga ut, öppna den personens nya registreringslänk. Den lokala profilväljaren kan inte ändra inloggad identitet. Andra personer kan fortfarande filtreras/anges som deltagare i kalendern.

De tre identiteterna använder interna, icke levererbara Auth-adresser under `devices.familjen.invalid`. Dessa är kontoidentifierare, inte verifierade personliga e-postadresser. Administratören ansvarar för att ge rätt länk till rätt person/enhet. Ingen registreringsmejl skickas till dessa adresser. Öppen sign-up och anonymous Auth sign-ins är avstängda.

Om verkliga e-postadresser senare används kan befintliga användare begära en personlig länk. Auths magic-link-mall är konfigurerad med `{{ .TokenHash }}` i fragmentet; ersätt inte den med ett implicit access-token-fragment som krockar med hash-routing. Site URL är GitHub Pages-adressen; lokal verifieringsadress finns i redirect-allowlist.

## Behörigheter

- Alla familjetabeller har RLS. `anon` saknar både tabellåtkomst och execute på privata RPC:er.
- `calendar_identity` och `calendar_family_id` härleder enbart från `auth.uid()`. Klienten skickar inget familje-ID eller identitetsbevis från localStorage.
- `calendar_snapshot` är security invoker och läser RLS-skyddade familjerader.
- `calendar_save`, `calendar_delete`, `calendar_import` är security definer med tom search_path, explicit familjekontroll och familjefilter i alla mutationer. Identitet och familj härleds på servern; payload-fält kan inte byta dem.
- Direkta tabellskrivningar är nekade även för autentiserade kalenderanvändare. Profiler, familjer och personprovisionering är admin-only. Alla familjemedlemmar får redigera den gemensamma kalendern; `created_by`/`updated_by` är serverstyrda.
- Kalenderns tabeller heter nu `private_calendar_events`, `private_calendar_people`, `private_calendar_settings` och `private_school_lessons`. Publikationsmedlemskap för Realtime bevaras vid namnbyte; RLS filtrerar leveranserna.
- Utloggning rensar klientstate, pågående detalj/editor och realtidskanaler. Sena svar får inte återställa gammal data. Realtid får den autentiserade token och laddar om snapshot vid återanslutning. Privat data cachas inte av service worker.

## Skolscheman

Sallys 24 källposter inklusive fem luncher är granskade. Filerna ligger i git-ignorerade `private-imports/`. Neos fil är separat och tom eftersom källbilden saknas. Inga tider uppskattas. **Ingen import före bekräftad terminsstart, terminsslut och undantagsdatum.** Gamla eventuella skolrader får `term_confirmed=false` vid uppgradering och renderas inte innan de importerats med bekräftad period.

## Drift och återkallning

Registreringslänkar och refresh tokens är hemligheter. Dela aldrig samma länk mellan familjemedlemmar eller spara den publikt. Administrativa nycklar hör enbart hemma i administratörens process/server, aldrig i `VITE_*`, Pages eller privatregistreringsfiler. En förlorad enhet återkallas i Auth-administrationen. Att ändra profilkoppling stoppar nya API-läsningar omedelbart; befintlig JWT/session kan fortfarande behöva återkallas för andra Auth-flöden. Redan hämtad data kan inte tas tillbaka från en enhet.

Projektets initiala databaslösenord skapades slumpmässigt och sparades inte. Management API användes för migrationerna. Återställ lösenordet i Dashboard om direkt SQL/CLI-db-anslutning behövs. Förnya inte kontots/andra projekts nycklar av misstag.

Referenser: [Supabase sessions](https://supabase.com/docs/guides/auth/sessions), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink).

## Utfärda nya länkar lokalt

Kör `python3 scripts/create-registration.py` på macOS med rätt CLI-kontoprofil. Endast engångslänkar sparas i privata, git-ignorerade HTML-filer; administrativa nycklar stannar i minnet. Öppna respektive fil på rätt telefon via en privat överföring. Installerad PWA och vanlig Safari-flik kan ha separata sessioner; registrera den avsedda appmiljön. Om länken har gått ut eller använts: utfärda en ny.
