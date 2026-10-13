> Phase 1-tillägg: användaren har senare valt offentlig kalender för både läsning och redigering. Det genomförs i separata `open_*`-tabeller; nedanstående privata Phase 0-modell är fortsatt stängd. Se [Phase 1 setup och aktuellt säkerhetsbeslut](phase1-setup.md). Ingen gemensam kod eller lokal profil används som autentisering.

# Säkerhetsmodell och Supabase-setup

## Gränser

GitHub Pages distribuerar offentligt läsbara statiska filer. Därför innehåller bygget inga privata uppgifter. Lokal profilväljare ger ingen åtkomst och dess ID används aldrig som behörighetsbevis. Supabase Auth JWT + administrativt provisionerat medlemskap i `profiles.auth_user_id` avgör databasåtkomst. Familjemedlemmar får läsa familjens gemensamma data; egna pushprenumerationer är bara läsbara av ägaren. Positioner är läsbara av familjen, skrivbara endast av positionsägaren. Chatt och aktivitetsförfattare måste vara autentiserad profil. Profiler och familjer kan bara administreras från betrodd server/SQL Editor.

RLS är aktiverad på samtliga tabeller. `anon` saknar tabellrättigheter; ingen anonym policy finns. Inloggade konton utan medlemskap får inga rader. Familje-ID och profil-ID binds med sammansatta foreign keys för att förhindra korskoppling mellan familjer. Medlemsfunktionerna är `security definer` med tom `search_path`, kvalificerade tabellnamn och begränsad execute-rättighet för att undvika rekursiv profil-RLS. Flytta inte administrativ provisioning till klienten. Anonym Auth-inloggning är inte en registreringslösning för denna app.

## Exakta installationssteg

1. Skapa eget Supabase-projekt på tillgänglig gratisnivå. Välj lämplig region och förvara databaslösenord privat.
2. Kör `supabase/migrations/202610130001_phase0.sql` en gång via SQL Editor eller Supabase CLI migrations. Ingen seed med familjedata ingår.
3. Stäng av öppen användarregistrering och anonymous sign-ins i Auth. Förbered inbjudna användare med verifierade e-postadresser. Aktivera lösenordsfri e-post-OTP/magic link, korrekta redirect-URL:er och mailleverans. Inga lösenord behövs, men engångsregistrering och identitetsverifiering krävs. Dela inte en persons inloggningslänk med övriga.
4. Lägg administrativt in en `families`-rad och tre `profiles`-rader med motsvarande `auth.users.id` som `auth_user_id`. UUID:erna i databasen är separata från UI-valen `tobias`, `neo`, `sally`. Identitetskopplingen kommer från autentiserad användare, aldrig från lokal profil. För barn utan egen verifierbar inloggningskanal måste en säker, uttryckligt beslutad enhetsregistrering utformas innan dataåtkomst aktiveras.
5. Lägg projekt-URL och **publishable** nyckel (alternativt äldre anon-nyckel) i `.env` och valfria GitHub repository variables. Aldrig `service_role`, `sb_secret_*`, JWT-signeringsnyckel eller databaslösenord. `.env` är git-ignorerad.
6. Implementera och verifiera Auth-flödet i Phase 1 innan privat data laddas. Klientgränsen `requireSession` verifierar användaren; RLS är sista skyddet. Lokal profil får inte ändra autentiserad ägare. Utloggning ska rensa känsligt appstate och realtidskanaler.
7. Verifiera i ett isolerat projekt: oinloggad klient kan inte läsa/skriva någon tabell; inloggad icke-medlem får inga rader; familj A kan inte läsa/skriva familj B; familjemedlem kan inte provisionera profiler, skriva annans position, skicka som annan eller läsa annans pushendpoint. Testa även UPDATE till annan `family_id`. Migrations- och RLS-tester körs i PGlite/PostgreSQL med emulerad Auth-funktion (`src/data/security.test.ts`). De verifierar SQL och policyer; integration med riktiga Supabase JWT/testidentiteter återstår.
8. Aktivera endast nödvändiga tabeller för Realtime i Phase 1 och testa att kanalernas behörigheter följer RLS. Lagra aldrig pushhemligheter i publika tabeller.

Gratisnivåer och mailkvoter kan begränsa drift; dokumentera aktuella begränsningar vid aktivering. Säkerhetskopiering, återställning och retention för chatt/positioner behöver beslutas innan skarp användning. Koordinater och pushendpoints får inte skickas till loggar eller analysverktyg.

Referens: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase users och administrativa nycklar](https://supabase.com/docs/guides/auth/users).
