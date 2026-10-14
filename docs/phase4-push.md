# Phase 4 – pushnotiser och påminnelser

## Levererat

Serverstyrda notiser för nya chattmeddelanden, skapade/ändrade/inställda aktiviteter, tilldelade/ändrade/slutförda uppgifter och nya inköpsvaror. Direkta åtgärder notifierar aldrig avsändaren. Chattredigering/radering och avbockning av inköp skapar inga nya notiser. Shoppingtillägg grupperas per mottagare i tvåminutersfönster; olika avsändares egna varor inkluderas inte i deras sammanfattning.

Schemalagda påminnelser omfattar privata aktiviteter, återkommande aktiviteter och aktiverade skolscheman, inklusive luncher. Terminer och lovundantag respekteras med samma kalenderlogik som i appen. Enskilda schemaundantag hoppas över.

Inga avstängningsknappar eller val för olika notistyper finns i appen. Den gamla chattinställningen är borttagen och dess RPC kan inte längre stänga av notiser. Telefonens behörighet gäller alltid. Testnotisen är ett uttryckligt undantag från regeln om egna åtgärder och skickas till den egna profilens registrerade enheter.

## Tidsregler och standardval

- Tidsatta aktiviteter: påminnelse 30 minuter före start, med högst en minuts normal schemaläggningsfördröjning. Redan startade aktiviteter får inga nya påminnelser.
- Heldag börjar vid lokal midnatt i kalendern. Samma 30-minutersregel ger därför påminnelse **23:30 svensk tid kvällen före**. Telefonens ljudlösa läge/fokus respekteras; appen kringgår det inte.
- Uppgifter har datum utan klockslag. Deadline påminns **08:00 svensk tid**, följt av högst en förfallen-påminnelse **08:00 nästa dag**. Ingen daglig upprepning därefter.
- Schemalagda personliga påminnelser går till deltagare/ansvariga även om de själva skapade objektet. De är inte notiser om egna direkta ändringar.
- Jobbnycklar identifierar objekt, förekomst, start/deadline och mottagare. Samma pollning eller återförsök ger inte nya jobb. Återkommande uppgifter får egna ID:n per förekomst.
- Scheduler återhämtar högst fem minuters missade påminnelser. Längre avbrott ger inte en storm av gamla notiser.

## Plattformar och användning

Efter registrering visas **Aktivera notiser** på startsidan och i Inställningar. Behörighet begärs bara vid knapptryckning. Vid redan tillåten behörighet återställs en befintlig prenumeration automatiskt; registreringen behöver inte göras om vid vanliga besök.

Android Chrome: öppna senaste Familjen, välj Aktivera notiser och godkänn webbläsarens fråga. Installation rekommenderas men vanlig Android Chrome kan också stödja push. iPhone/iPad: öppna i Safari, välj Dela → Lägg till på hemskärmen, öppna installerade Familjen och aktivera notiser där. Kräver iOS/iPadOS 16.4 eller senare. [Apple: Web Push och användarinteraktion](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).

Vid nekad behörighet visar appen instruktioner för telefonens/webbläsarens inställningar och försöker inte kringgå beslutet. Knappen **Skicka testnotis** köar en testnotis; normal leverans startar inom en minut. Högst ett test per profil/minut. Testa även efter att appen stängts. Klick öppnar rätt kalenderaktivitet, uppgift, inköpslista eller chatt. Kallstart återställer sessionen innan det privata objektet öppnas.

Om appen begär en uppdatering måste den nya service workern aktiveras innan push kan anslutas. En gammal worker utan push-handler ger ett begripligt uppdateringsmeddelande. Appens PWA-identitet, cache och autentiseringsnycklar är oförändrade.

## Arkitektur och säkerhet

Migration `202610140010_push.sql` inför privata jobb/leveranser, verifierade databas-triggers, egna prenumerations-RPC:er och server-only arbets-RPC:er. En prenumeration knyts till `auth.uid()` → profil → familj **och aktuell Auth-session**. Klienten kan inte välja mottagare, avsändare eller annan profil. Återkallad/raderad session tar bort prenumerationen genom FK, och varje claim verifierar även sessionsägarskap. Utloggning kopplar bort browserprenumerationen och rensar worker-ägaren, utan att påverka andra enheter.

Endpoint och krypteringsnycklar är inte läsbara via klientens tabellåtkomst. RLS och nekade grants skyddar alla nya tabeller; endast service-role-RPC:er kan hämta jobb för leverans. Samma endpoint kan inte tas över av en annan profil. Endast HTTPS hos FCM, Apple Web Push och Mozilla accepteras. Portar, användarinformation, andra värdar och omdirigeringar nekas för att förhindra SSRF.

VAPID privatnyckel och separat worker-hemlighet finns endast i Supabase Edge Secrets. Cron hämtar hemligheten från Vault, aldrig från en literal i jobbkommandot. Workerns POST kräver hemligheten; dess enda offentliga konfigurations-GET lämnar bara den publika VAPID-nyckeln. Frontendbygget accepterar endast en publik VAPID-nyckel i `config/public-push.json`.

Migration 011 återställer avbrutna osända påminnelser utan nya jobb-ID:n och avslutar utgångna leases.

Workern `push-worker` kör varje minut via `pg_cron` och `pg_net`. Databasändringar notifierar via kön även när inga webbläsare är öppna. [Supabase: schemaläggning med Vault](https://supabase.com/docs/guides/functions/schedule-functions).

Leveranser har unika jobb/enhetsnycklar, transaktionslås, tvåminutersleasing, säkra återförsök med backoff och högst sex försök. HTTP 404/410 avaktiverar utgångna prenumerationer; 429/nätfel/5xx återförsöks. Påminnelsers provider-TTL går ut vid aktivitetsstart. Jobb sparas privat och städas efter sju dagar. Edge-loggar och svar innehåller endast antal och generiska fel, aldrig meddelandetext, endpoints eller hemligheter.

Web Push kan inte garantera exakt en extern leverans om en provider accepterar ett meddelande men nätverkssvaret går förlorat. Stabil provider-topic, notification-tag och atomär IndexedDB-dubblettkontroll i service workern förhindrar upprepad visning i normala återförsök. Workerlagringen innehåller endast ägar-ID och sedda jobb-ID:n, inte familjens meddelandetexter. Operativsystem, batterisparläge och nätverk kan fördröja eller stoppa leverans.

## Drift och setup

Familjens befintliga separata Supabase-projekt har migrationerna 010–011, Edge Secrets, publicerad worker och aktivt minutjobb. Inga manuella administratörsåtgärder behövs där.

Vid ny miljö: kör migrationerna i ordning, logga in med Supabase CLI och kör `python3 scripts/configure-push.py` från repositoryt. På andra operativsystem kan operatören tillhandahålla `SUPABASE_ACCESS_TOKEN` i processmiljön. Skriptet skapar VAPID-nycklar bara när de saknas, bevarar befintliga nycklar, publicerar funktionen och konfigurerar Vault/cron med `supabase/push-scheduler.sql`. Endast publik VAPID skrivs till frontendkonfigurationen. Committa den publika konfigurationen och publicera Pages.

Byt aldrig VAPID-nycklar som rutinmässig deployåtgärd. En rotation kräver ny browserprenumeration. Återställ en saknad publik nyckel från workerns `/config`; privata nycklar ska aldrig kopieras till repot, chatten eller `VITE_*`. För lokal Edge-utveckling finns `supabase/functions/.env.example` med tomma värden.

Övervaka `cron.job_run_details`, HTTP-statusar i `net._http_response` och Edge-funktionens räkneverk. Cron-status success betyder att HTTP-anropet köats; kontrollera även HTTP 200 från workern. Private kötabeller är administratörsdata, inte offentliga loggar.

## Verifiering och återstående telefonkontroll

Enhets-/SQL-tester täcker regler, mottagare, sessionskoppling, nekad åtkomst, dubbletter, leases, återförsök, ogiltiga prenumerationer, svensk tid/DST, återkomst, skolundantag och deadline/överförfall. Service worker-test täcker privat ägare, dubblettkontroll och säkra klicklänkar. Deno-integrationstest använder verklig VAPID-kryptering och kontrollerad providertransport för 201, 429 och 410. Mobil-E2E simulerar browserprenumeration/behörighet och använder riktiga SQL-migrationer; det är inte fysisk pushleverans.

Mot riktig Supabase verifierades sessionskoppling, nekad endpointövertagning, server-only kö, två chattmottagare, autentiserad Edge-worker och faktisk FCM-avvisning av en avsiktligt ogiltig testendpoint. Prenumerationen avaktiverades korrekt. En verklig återkommande aktivitets påminnelse köades exakt en gång över två worker-pollningar. Två tillfälliga separata familjer verifierade även familjeisolering, förfalskad familjemetadata och nekad återkallning av en annan familjs prenumeration. Cron har också returnerat HTTP 200 utan öppna appklienter. Testposterna städades och Sallys 48 aktiverade periodrader bevarades.

**Fysisk Android- och iPhone-leverans är inte verifierad.** Aktivera behörigheten på varje telefon och använd testnotisen. Prova sedan chatt från en annan familjemedlem med mottagarens app stängd, öppna notisen och kontrollera rätt vy. Testa en kommande aktivitet och deadline enligt tidsreglerna ovan. Ingen återkommande kod eller lösenordsinloggning behövs på en redan registrerad enhet.

Nästa fas: Phase 5 – familjekarta och frivillig GPS i förgrunden, med tydlig ålder på positionen och utan bakgrundsspårning.

Slutkontroller lokalt: lint, typecheck, produktionsbuild, 144 enhets-/SQL-/service worker-tester, 2 Deno Edge-integrationstester och 56 mobil-/PWA-E2E. Alla passerar. Browserprenumerationer och OS-behörighet simuleras i E2E; hosted ogiltig-endpoint-test verifierar avvisning och städning, inte lyckad fysisk pushleverans.
