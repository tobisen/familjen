# Phase 2 – gemensamma listor

## Funktioner

Listor har flikarna **Att göra** och **Inköp**. Alla registrerade familjemedlemmar kan hantera samma data. Plusknappen öppnar rätt formulär i listvyn; på startsidan väljer man aktivitet, uppgift eller inköp.

Uppgifter har titel, beskrivning, flera ansvariga, deadline som svensk kalenderdag, prioritet och valfri daglig/veckovis/månadsvis återkomst. Filter: Alla, Mina (alla tilldelade uppgifter, även klara), Aktiva och Klara. Skapare och slutförare hämtas från serverns profiler. Startsidan visar fem aktuella uppgifter med deadline först, inklusive förfallna, och antal varor kvar att köpa.

Inköp har namn, numeriskt antal med högst tre decimaler och valfri enhet. Snabbinmatning sker direkt i vyn. Avbockning tar bort varan från aktiva listan när servern bekräftat skrivningen och sprids via Realtime till övriga enheter. Senaste avbockning kan ångras; alla köpta varor kan återställas från historiken. Både uppgifter och inköp kan redigeras och raderas med bekräftelse.

## Återkomst och påminnelser

När en återkommande uppgift slutförs skapar databasen nästa uppgift i samma transaktion, med samma ansvariga, beskrivning, prioritet och påminnelseval. Nästa deadline är föregående deadline + en dag/vecka/månad. Månadsåterkomst behåller ursprungsdagen, men använder månadens sista dag när dagen saknas: 31 januari → 28 februari → 31 mars. Skottår stöds. Datum är kalenderdagar, utan förskjutning vid sommartid.

Försenade tillfällen hoppas inte över: nästa uppgift kan också vara förfallen. Endast nästa tillfälle skapas; inget bakgrundsjobb producerar obegränsade uppgifter. Återställning av en klar uppgift lämnar den redan skapade efterföljaren kvar. Att slutföra samma uppgift igen skapar aldrig ytterligare en efterföljare. Redigering gäller vald uppgift, inte redan skapade tillfällen. Radering av det aktiva tillfället stoppar den fortsatta kedjan. Automatiskt skapad uppgift får slutföraren som skapare, vilket visar vem som utlöste skapandet.

`reminder_days` förbereder framtida pushpåminnelser. UI säger uttryckligen att inga påminnelser skickas ännu. En framtida serverprocess kan använda deadline, ansvariga, version och färdigstatus; inga notifieringsbehörigheter begärs i denna fas.

## Databas och säkerhet

Migration `202610130006_family_lists.sql` är tillämpad i det separata Familjen-projektet. Den utökar befintliga `tasks` och `shopping_items`, och skapar `task_assignees` med sammansatta främmande nycklar så att uppgift och ansvarig alltid tillhör samma familj. Gamla rader och äldre mängdtext bevaras; tidigare ensam ansvarig kopieras till relationstabellen. Kalender, skolrader, registreringskoder och Auth-sessioner ändras inte.

Alla tre listtabeller har RLS och ingår i Supabase Realtime-publicationen. Autentiserade registrerade medlemmar kan läsa den egna familjen. Direkta skrivningar är nekade även för medlemmar. `lists_snapshot`, `lists_save`, `lists_set_done` och `lists_delete` kräver serverbundet medlemskap. Mutationsfunktionerna har tom `search_path` och härleder familj och skapare/slutförare från `auth.uid()`. Klientens extra identitetsfält ignoreras; ansvariga valideras mot familjens profiler. Anonyma roller saknar RPC- och tabellbehörigheter.

Servern använder radlås och versionskontroll. Två avbockningar till samma önskade status är idempotenta, medan motstridiga ändringar med gammal version nekas. Användaren får då öppna posten på nytt. Klienten hindrar dubbeltryck under sparandet. Nya poster använder ett stabilt request-ID vid återförsök med samma formulärvärden; ändrade värden får ett nytt ID. Återkommande efterföljare har unik föräldrakoppling och kan inte skapas dubbelt. Radering är mjuk så att Realtime kan leverera borttagningen som en familjeskyddad UPDATE.

## Arkitektur och återanslutning

- `src/domain/lists.ts`: typer, filtrering, deadlineetiketter och validering.
- `src/data/listsRepository.ts`: enda listadapter för RPC/Realtime med tidsgränser.
- `src/stores/lists.ts`: laddning, sparande, prenumeration, fel, återställning och UI-state.
- `src/views/Lists.vue` och `src/components/ListEditor.vue`: mobila listor och formulär.

Realtime laddar om listans snapshot vid ändring/prenumeration. Samtidiga läsningar slås samman och gör en ny läsning om data ändrats under hämtning. Förgrund, återanslutning och online-händelser uppdaterar data. Listorna sparas inte i service worker eller annan bestående offline-cache. Offline visas befintlig data från minnet och ändringar är avstängda. Utloggning rensar data, editor, ångra-state och kanaler; sena svar kan inte återställa tidigare användares data. Tokenförnyelse återanvänder samma serverbundna familjeidentitet. Osparade formulär återställs vid en full omladdning av appen.

## Verifiering

89 enhetstester passerar. Nya tester omfattar verklig migrations-SQL i PGlite, CRUD, filter, mängder, återställning, skapare/slutförare, återkomst/skottår/DST-datum, idempotens, versionskonflikter, RLS och familjeisolering. Storetester verifierar dubbeltryck, sammanslagna läsningar, felhantering och sena svar efter utloggning.

30 E2E körs i Chromium och WebKit med mobil viewport: 20 för kalender/listor/registrering och 10 för appskal/PWA. De omfattar formulär, filter, återkomst, startsida, historik, återställning, raderingsbekräftelse och fel vid avbockning samt tidigare funktioner. Det är inte tester på fysiska telefoner.

`scripts/live-lists.mjs` har verifierat riktig Supabase med tre separata autentiserade webbläsarsessioner för Tobias, Neo och Sally: Realtime utan omladdning, köp/historik/återställning, återkommande uppgifter, samtidig avbockning, motstridiga samtidiga redigeringar, offline/återanslutning och sparad session. `scripts/live-lists-rls.mjs` har verifierat åtkomst från annan familj och oregistrerad Auth-identitet samt skydd mot manipulerad familj/skapare. Indata och tillfälliga tokens skickas enbart via stdin och loggas inte. Testerna rensar sina egna märkta poster från de synliga listorna.

## Begränsningar och fortsättning

Ändringar kräver nätverk. Historik och aktuella uppgifter läses som en familjesnapshot utan paginering; vid större datamängder bör historiken pagineras och mjukraderade verifieringsposter få en separat administrativ gallringsrutin. Pushpåminnelser är förberedda men inte aktiverade. Den tidigare registreringsmodellen med personliga engångskoder utan tidsgräns gäller fortsatt.

Nästa fas kan vara familjechatten, med samma medlemsmodell, privat RLS och Realtime. Push/påminnelser följer som en separat serverfunktion.
