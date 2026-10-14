# Phase 3.1 – skolscheman

## Status och grundorsak

Tidigare fanns bara ignorerade lokala JSON-underlag. Inga lektioner hade lagrats i `private_school_lessons`. Sallys 24 veckoposter inklusive fem luncher saknade terminsdatum. Neos fil var tom. Den gamla förhandsgranskningen kunde varken korrigera rader eller importera en komplett del av ett ofullständigt schema.

Underlagen finns nu i **privat Supabase-lagring**, tillgängliga för familjens registrerade identiteter. De ingår inte i GitHub-repot, frontendpaketet eller service worker-cachen. Sally har 24 kompletta tider. Neo har 18 preliminära poster med saknade sluttider och bevarade cirka-markeringar. Inga originalbilder finns i repositoryt.

**Sallys schema är nu aktiverat för båda terminerna:** 24 återkommande veckoposter inklusive fem luncher per termin, lagrade som 48 periodbundna rader. Användaren bekräftade årskurs 1 och gav uttryckligen tillåtelse att göra rimliga val som kan korrigeras i appen.

- HT 2026: 2026-08-17–2026-12-22. Startdatumet är verifierat. **22 december är ett preliminärt valt slutdatum**, dagen före skolans publicerade jullovsstart; det är inte ett verifierat besked om sista undervisningsdagen. Detta framgår även av anteckningarna i appen.
- VT 2027: 2027-01-13–2027-06-10. Båda gränserna är verifierade för Sallys nu bekräftade årskurs.
- Samma granskade veckounderlag används i båda perioderna tills manuell uppdatering. Höstlov vecka 44, sportlov vecka 8, påsklov och röda dagar undantas. Uppropsdagen 17 augusti undantas från ordinarie schema enligt skolans [skolstartsbesked](https://drottningblanka.se/uppsala/nyheter/).
- Studiedagar, klämdagar och särskilda första/sista skoldagar behöver fortfarande kontrolleras i Schoolsoft. De okända dagarna har inte hittats på. Redigera periodens datum/undantag i administrationen och importera igen med samma period-ID.

**Neo är inte aktiverad:** samtliga 18 poster saknar verifierade sluttider och vissa starttider är ungefärliga. Dessa tider uppskattas inte.

## Officiella källor, kontrollerade 2026-10-14

### DBGY Uppsala

[Skolans läsårstider](https://drottningblanka.se/uppsala/om-dbgy/lasarstider/) saknar årtal i den synliga texten och har en gammal rubrik 2024/2025. **HTML-källans åtta `<time datetime="…">` innehåller däremot fullständiga datum för 2026/27**, verifierade genom direkt hämtning från skolan. Publiceringssidans ändringstid är 2026-08-14. Årtalen kan alltså verifieras trots sidans missvisande presentation.

| Händelse                        | Verifierat datum      |
| ------------------------------- | --------------------- |
| Höstterminsstart                | 2026-08-17            |
| Höstlov, vecka 44               | Från 2026-10-26       |
| Jullov                          | Från 2026-12-23       |
| Vårterminsstart                 | 2027-01-13            |
| Sportlov, vecka 8               | Från 2027-02-22       |
| Påsklov                         | 2027-03-30–2027-04-02 |
| Avslutning, uttryckligen åk 1–2 | 2027-06-10            |
| Student                         | 2027-06-11            |

**Höstterminens sista undervisningsdag anges inte uttryckligen.** Efter användarens tillåtelse används 22 december som ett tydligt markerat preliminärt slutdatum. Sallys årskurs 1 är nu bekräftad, så avslutningen 10 juni kan användas för hennes vårtermin. Studiedagar och andra avvikelser hänvisas fortfarande till Schoolsoft. Kommunens datum ersätter inte skolans egna.

Sportlov vecka 8 motsvarar 22–28 februari 2027. Skolans påsklov 30 mars–2 april kompletteras med långfredag 26 mars och annandag påsk 29 mars. Kristi himmelsfärdsdag 6 maj undantas också. [Lag om allmänna helgdagar](https://data.riksdagen.se/dokument/sfs-1989-253.html) anger helgdagarna; [datum för påsken 2027](https://publicholidays.se/sv/easter/) och [Kristi himmelsfärdsdag 2027](https://publicholidays.se/sv/ascension-day/) har kontrollerats separat. Inga okända studiedagar, Valborg eller klämdagar har lagts till för DBGY.

### Amerikanska Gymnasiet Uppsala

[Skolans svenska sida, Läsårstider 2026/27](https://amerikanskagymnasiet.se/vara-skolor/uppsala/) anger följande:

| Händelse              | Datum                 |
| --------------------- | --------------------- |
| Läsårsstart           | 2026-08-11            |
| Höstlov               | 2026-10-19–2026-11-01 |
| Termin 2 start        | 2026-11-02            |
| Jullov                | 2026-12-22–2027-01-06 |
| Sportlov              | 2027-02-22–2027-03-07 |
| Termin 3 start        | 2027-03-08            |
| Påsklov               | 2027-03-26–2027-04-04 |
| Valborg               | 2027-04-30            |
| Kristi himmelfärdsdag | 2027-05-06            |
| Student               | 2027-06-11            |
| Läsårets sista dag    | 2027-06-14            |

Skolan har tre terminer. Separata HT/VT-gränser anges inte. Utkastet använder uttryckliga läsårsgränser; ingen terminsgräns härleds från loven. Studentdagen är inte automatiskt inlagd som lovdag. Årskursens avslutning, studiedagar och skolstartens särskilda tider måste kontrolleras inför aktivering.

[Engelska sidan](https://amerikanskagymnasiet.se/en/our-schools/uppsala/) innehåller dubbla och motstridiga block, bland annat 9 november som termin 2-start och andra majdagar. Den svenska skolans sida används som datakälla för utkastet. Motstridigheterna är inte ett bevis för att fler lovdagar saknas eller finns: kontrollera med skolan innan slutlig aktivering. Lovlistan på webben garanterar inte att alla studiedagar är publicerade.

## Användning på mobilen

1. Öppna **Inställningar → Hantera skolscheman** (eller Kalender → Importera schema).
2. Välj Sally eller Neo i sparade scheman. Importstatus visar antalet aktiverade veckoposter. Ladda om administrationen om en annan enhet har ändrat schemat.
3. Öppna en lektion för att korrigera dag, ämne, start/slut, sal och enskilda undantagsdatum. Markera lektionen verifierad först efter kontroll mot källa. Cirka-tider och saknade sluttider visas uttryckligen. Lägg till eller ta bort rader i utkastet vid behov.
4. Ange verifierade periodgränser. Lägg till lov/studiedagar med datumintervall eller enskilda datum. Gränser och undantag är inklusive. Spara utkast utan att ändra kalendern.
5. Bekräfta underlaget och välj **Importera schema**. Endast kompletta verifierade rader aktiveras; övriga stannar i utkastet. Exakt antal visas.
6. Behåll period-ID vid uppdatering. Ny termin får nytt period-ID (t.ex. `vt2027`). Sätt periodens slut så att två perioder inte överlappar oavsiktligt.
7. **Ersätt** tar endast bort tidigare aktiverade skolrader från just denna familj/elev/period som nu saknas eller blivit ofullständiga. Privata kalenderaktiviteter berörs aldrig. Minst en komplett lektion krävs för aktivering/ersättning.
8. Kalenderns **Skola**-filter visar skolaktiviteter. **Visa luncher** styr luncherna i dag-, vecko- och månadsvy. Färg, elev, ämne, tid och sal använder befintliga kalenderkomponenter.

JSON med tidigare format fungerar fortsatt. Vid filinläsning föreslås ett stabilt period-ID från startdatum, annars `term-utkast`; kontrollera ID före import. `confirmed:false` håller en rad preliminär, `uncertainty` bevarar källans reservationer och `exception_dates` på en lektion undantar endast den lektionen. Alla tider tolkas som svensk lokal tid; ingen okänd sluttid fylls i.

## Databas och säkerhet

Migration 008 skapar `private_school_imports` och skyddade `school_snapshot`/`school_save`. Migration 009 validerar även utkastens struktur på servern. Familjen härleds från `auth.uid()` och befintlig profilkoppling. Anonym åtkomst, direkt skrivning till tabeller och åtkomst från andra familjer nekas. Alla registrerade familjemedlemmar kan administrera scheman, enligt befintlig familjemodell.

Aktivering använder samma `calendar_import` och `calendar_snapshot` som tidigare. Lektionsnyckeln får prefix `period:<period-ID>:`; befintlig unik familj/elev/extern-ID och upsert behåller UUID vid uppdatering. Optimistisk version och transaktionslås skyddar samtidiga ändringar. Ersättning sker atomärt med import och metadata. Privata aktiviteter lagras i en annan tabell som schemaadministrationen aldrig ändrar.

Ändringar höjer befintlig kalenderrevision. Befintlig Realtime-prenumeration och återanslutning hämtar skolaktiviteter tillsammans med resten av kalendern. Administrationsdialogen har en uttrycklig hämta-knapp och versionskonflikt ger fel i stället för att skriva över en annan enhets ändring. Känsliga underlag eller administrativa nycklar cachas inte i PWA-resurser.

## Verifiering

Enhets-/SQL-tester täcker partiell import, validering, dubbletter, stabila UUID, separata perioder, ersättning, versionskonflikter, behörigheter, terminsgränser, lov, individuella undantag och svensk sommar-/vintertid. Mobil-E2E kör samma flöde i Chromium och WebKit, inklusive alla tre kalendervyer, lunchfilter och omladdning.

`scripts/live-school.mjs` tar tillfälliga autentiserade sessioner via stdin. Verifieringen använder riktig Supabase och tre separata webbläsarkontexter: privata underlag, syntetisk partiell aktivering, realtid, ändring, återanslutning och samma UUID efter omimport. Testets syntetiska poster städas med exakta identifierare av en betrodd operatör. Testsessionerna loggas ut separat; befintliga telefoners sessioner påverkas inte. Fysiska telefoner har inte verifierats.

Verifierat lokalt: lint, typecheck, 124 enhets-/SQL-tester, 34 kalender-/list-/chatt-/Auth-E2E och 16 app-/PWA-E2E. Produktionsbygget passerar. Hosted RLS har även verifierats med en separat tillfällig autentiserad familj: inga andra familjers scheman kan läsas, förfalskad familjemetadata ger inte åtkomst och direkt tabellskrivning nekas. De riktiga underlagen och aktiverade schemana bevaras när syntetiska testposter och testfamiljen rensas.

Efter faktisk aktivering verifierades Sallys schema på GitHub Pages för Tobias, Neo och Sally i tre separata autentiserade webbläsarkontexter: dag-, vecko- och månadsvy, rätt personfärg, båda periodernas importstatus samt samma 48 lagrade skolrader. Upprepad höstimport behöll samtliga UUID. Privata aktiviteter jämfördes före/efter och var oförändrade.
