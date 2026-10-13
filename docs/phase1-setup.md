# Phase 1: separat Supabase-projekt

## Beslut och aktuell gräns

Ursprungsuppdraget föreskrev privat kalender och lösenordsfri autentisering. Under implementationen ändrade användaren uttryckligen detta till **offentlig kalender, även för redigering av vem som helst med adressen**. Därför finns inga Auth-koder eller registreringar i kalenderflödet. Lokal profil väljer förvald deltagare; den är aldrig en verifierad identitet. Det går inte att tillskriva en ändring säkert till Tobias/Neo/Sally. Detta är ett medvetet nytt krav, inte en autentiseringslösning.

Separata `open_*`-tabeller och `public_calendar_*`-RPC:er gör detta utan att öppna Phase 0:s privata profiler, familjer, chatt, GPS, push eller listor. Schemaimport är offentlig efter aktiv publiceringsbekräftelse.

## Exakta steg när projektåtkomst saknas

1. Anslut Supabase-integrationen här, eller skapa själv ett **nytt** projekt `familjen` i Supabase Dashboard. Använd inte Vinskåpets projekt/ref/nycklar. Välj kostnadsfri plan om tillgänglig och lämplig region. Inget projekt har skapats automatiskt utan bekräftad kontoåtkomst.
2. I det nya projektets SQL Editor: kör `supabase/migrations/202610130001_phase0.sql`, därefter `202610130002_open_calendar.sql`, en gång vardera och i den ordningen. Alternativt använd Supabase CLI med rätt nytt projekt/ref. Vid befintlig Phase 0-databas: kör bara saknade migrationer, kör inte om tabellskapandet.
3. Bekräfta att kalendern ska vara offentlig och kör administrativt:

```sql
update public.open_calendar_settings set enabled = true where id = true;
```

4. Kopiera **projekt-URL** och **publishable key** från projektets API-inställningar till `.env`:

```text
VITE_SUPABASE_URL=https://DITT-SEPARATA-PROJEKT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_DIN_PUBLIKA_NYCKEL
```

Äldre anon-nyckel stöds också. Skicka aldrig service_role/secret key till klienten. Ingen Auth-registrering, gemensam PIN eller lösenord krävs för den offentliga kalendern. Stäng fortsatt av anonymous Auth sign-ins och publik användarregistrering; vanlig oinloggad API-roll `anon` är inte en anonym Auth-användare.

5. I GitHub → Settings → Secrets and variables → Actions → **Variables**: ange samma två publika värden. Starta workflow via Actions → Validate and deploy Familjen → Run workflow eller pusha en ändring. Dessa värden är offentliga klientvärden, inte hemligheter. Använd inte en annan apps värden.
6. Kontrollera Database → Publications → `supabase_realtime`: `open_calendar_events`, `open_school_lessons`, `open_calendar_people`, `open_calendar_settings` ska ingå. Migrationen lägger till dem om standardpublikationen finns. Aktivera inte privata tabeller på måfå.
7. Kör SQL-kontrollerna nedan och sedan ett riktigt tvåenhetstest: skapa på telefon A, se på B utan omladdning; redigera från B; bekräfta radering från A. Testa även från en privat/oinloggad webbläsare eftersom kalendern avsiktligt är offentlig. E2E:s lokala SQL-adapter verifierar inte Supabase Realtime eller dess JWT/protokoll.
8. Öppna kalenderns Importera schema. Välj lokala `private-imports/sally.draft.json`, kontrollera tider, startdatum och lov; bekräfta att barnets schema får publiceras offentligt. Neos fil måste kompletteras från källbilden innan import. Saknade sluttider får inte uppskattas. Inga importer görs automatiskt.

## Avstängning

```sql
update public.open_calendar_settings set enabled = false where id = true;
```

Det stänger offentlig läsning/skrivning i RPC och RLS. Redan nedladdad/offentlig information kan inte tas tillbaka. För att göra en redan offentlig kalender privat krävs dessutom ett nytt autentiserat åtkomstflöde; byt inte bara etikett i UI.

## Databasverifiering

Kör som databasadministratör i ett **testprojekt**, inte med privat klientdata:

```sql
begin;
set local role anon;
select public.public_calendar_snapshot(); -- fungerar endast när aktiverad
select * from public.chat_messages;      -- måste nekas (transaction aborted efter detta)
rollback;
```

Privata Phase 0-tabeller har ingen anonym policy och inga anon-tabellrättigheter. Direkt INSERT/UPDATE/DELETE på `open_*` är också nekad; kalenderns avsiktligt offentliga skrivfunktioner är begränsade till validerade fält och egna tabeller. Läsning sker via RLS. Skriv-RPC:er är `security definer` med tom search_path, kvalificerade namn och explicit kontroll av administrativ aktivering. Medlemskap/private identiteter kan inte provisioneras genom dem. Optimistisk `version` kontrolleras vid ändring/radering. Radering är en tombstone så att Realtime kan signalera den; snapshot filtrerar raderade poster.

PGlite-tester kör båda migrationerna och testar detta isolerat. Hosted Supabase/PostgREST och faktisk tvåenhetssynkning återstår tills ett projekt är anslutet.

## Driftbegränsningar

En offentlig redigerbar kalender kan vandaliseras, kopieras och överbelastas. Profilnamn bevisar inte vem som gjort något. Gratisnivåns lagring/mail/realtidskvoter är ingen driftgaranti. Inga automatjobb, SMS eller betalresurser startas. Ta regelbundna säkerhetskopior när riktig data börjar användas. Privat chatt, positioner och push kräver separat säker inloggning innan de kan aktiveras.

Referenser: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [databasfunktioner och security invoker/definer](https://supabase.com/docs/guides/database/functions), [Realtime](https://supabase.com/docs/guides/realtime/postgres-changes).
