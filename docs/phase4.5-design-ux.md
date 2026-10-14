# Phase 4.5 – design och användarflöden

## Gränssnitt

Mörkt tema är standard. Inställningar erbjuder ett ljust tema; valet sparas
lokalt och påverkar inte autentisering eller familjedata. Systemtypsnitt,
Lucide-ikoner och gemensamma färgtokens används utan externa typsnitt eller nya
beroenden. Animationer respekterar `prefers-reduced-motion`.

Fyra sticky huvudflikar: Kalender, Att göra, Inköp och Chatt. Listorna behåller
befintliga URL:er och pushlänkar. Startsidan leder till kalendern, där en kompakt
översikt visar uppgifter, inköp och senaste chattmeddelande. Kalenderns valda
Dag/Vecka/Månad bevaras vid navigation inom appen. Veckans tidsaxel kan fortfarande
svepas på smala skärmar. Karta nås via Inställningar.

Registrerad profil visas med avatar och namn. Inställningar har inget profilval.
En lokal ändring av `familjen.profile` påverkar inte serverns identitet eller RLS.
Telefonbyte sker fortfarande med en ny personlig engångskod, utan tidsgräns,
via det befintliga säkra registreringsflödet. Befintliga sessioner behålls.

## Deltagande och återkommande aktiviteter

`calendar_participate` lägger till eller tar bort endast den autentiserade
profilen, under radlås och versionskontroll. Minst en deltagare måste finnas kvar.
Importerade skolscheman ändras genom schemaadministrationen.
`task_assign_self` lägger till den inloggade personen utan att ersätta andra
ansvariga. Klienten skickar aldrig ett godtyckligt profil-ID till dessa RPC:er.

Aktiviteter kan upprepas dagligen, veckovis på startdatumets veckodag eller
månadsvis på dess datum, med valfritt slutdatum. Vid datum som inte finns i en
månad hoppas tillfället över, enligt befintlig kalenderlogik. Stockholmstid och
sommar-/vintertid hanteras fortsatt med Temporal.

Detaljvyn erbjuder redigering av hela serien eller bara detta tillfälle.
`calendar_save_occurrence` sparar seriens undantag och en fristående ersättning i
samma transaktion. Ogiltig ersättning återställer hela transaktionen; ett
upprepat anrop med gammal version skapar ingen dubblett. Radera detta tillfälle
skapar ett undantag; seriens radering kräver bekräftelse. En ersättning redigeras
fortsättningsvis separat, men migration 013 behåller kopplingen till serien så
att radering av hela serien även tar bort redigerade tillfällen.

## Raderade chattmeddelanden

Migration `202610140012_design_ux.sql` behåller soft delete internt, rensar
innehållet i historiska tombstones och skärper SELECT-policy till
`family_id = calendar_family_id() AND deleted_at IS NULL`. Befintliga invoker-RPC:er
för historik, förhandsvisning och lässtatus omfattas av denna RLS. Aktiva
meddelanden förändras inte. Bara ägaren kan fortsatt redigera/radera via
`chat_change`; direkt klientskrivning är inte tillåten.

En ny RLS-skyddad `chat_revisions`-tabell publicerar endast familje-ID och ett
versionsnummer. Den gör att klienterna upptäcker en radering även när RLS
korrekt hindrar tombstone-payloaden från att lämna databasen. Klienten hämtar om
sitt redan laddade historikintervall och ersätter det, i stället för att enbart
lägga till meddelanden. Samma avstämning sker vid återanslutning. Den ursprungliga
sidgränsen behålls även om alla synliga meddelanden raderas. Ingen platshållare,
tom bubbla, innehållstext eller oläst-räkning finns kvar efter radering.

## Verifiering

Enhetstester omfattar migration av historiska raderingar, direkt RLS-läsning,
sidindelning, olästa-räkning, versionskonflikter, deltagande, tilldelning och atomisk
redigering över vintertidsomställning. Playwright kör Pixel-/iPhone-vyer i
Chromium och WebKit, med regression för kalender, listor, chatt, registrering,
PWA-start, offline-skal, tema och sticky navigation.

`scripts/live-design.mjs` är ett separat operatörstest: sessioner tas emot på stdin
och loggas aldrig. Kör endast med en isolerad testfamilj och städa dess exakta
familje-ID efteråt. Det verifierar tre autentiserade sessioner, faktisk Supabase
Realtime, ägarbehörighet, borttagning, olästa-räknare, återanslutning och låst profil.
Inga riktiga familjemeddelanden behöver skapas eller raderas.

Webbläsaremulering är inte ett test på fysisk Android eller iPhone. PWA-identitet,
registrering, cachereparation och serverlagrade uppgifter behålls; endast
manifestets temafärger följer det nya mörka standardtemat.

## Körda kontroller

- Lint, typecheck och produktionsbuild inklusive service worker-koppling.
- 155 Vitest-tester och två Deno-tester för pushworker.
- 20 PWA-/navigationstester och 44 funktions-E2E i Chromium/WebKit.
- Hosted Supabase: tre isolerade autentiserade webbläsarsessioner, verklig
  Realtime-radering, olästa-räknare, ägarbehörighet och återanslutning godkända.
  Serverstyrt deltagande, tilldelning, enskild ersättning och serieradering är
  också verifierade mot hosted RPC med samma isolerade testfamilj.
- Migrationerna 012–013 är körda i Familjens separata projekt. Historiska tombstones
  saknar innehåll; aktiva meddelanden och Sallys befintliga scheman behålls.

## Korrigering av gammal appversion och notisruta

Den publicerade databasen kontrollerades efter rapport om kvarvarande
raderingsplatshållare: fem raderade meddelanden var korrekt markerade och inga
aktiva meddelanden innehöll de rapporterade platshållartexterna. Telefonens
installerade version kunde inte inspekteras; en äldre öppen appversion är därför
en sannolik förklaring, inte en verifierad enhetsdiagnos.

Chattvyn filtrerar nu även själv bort tombstones före rendering och datumgruppering.
Tillgängliga appuppdateringar tillämpas automatiskt när appen är synlig och ledig.
Registrering, öppna dialoger, fokuserade fält, oskickad text och väntande
chattmeddelanden skjuter upp uppdateringen. Autentiseringslagring rensas inte.
En redan öppen version från före rättningen behöver fortfarande laddas om:
tryck **Uppdatera appen** när meddelandet om ny version visas. Vid behov finns
**Återställ appens cache** i Inställningar; den behåller autentiseringssessionen.

Startsidan visar notisinformation endast tills behörighet och prenumeration är
klara, eller om ett anslutningsfel behöver hanteras. Vid godkänd aktivering
försvinner hela rutan omedelbart, även dess hjälpinformation. I Inställningar
finns status och testnotis kvar. Detta testas både som komponent och i mobila E2E.
