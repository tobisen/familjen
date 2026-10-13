> Phase 1.5 gäller nu: import är privat och kräver bekräftad terminsstart **och** terminsslut. Det tidigare undantaget om obegränsad giltighet gäller inte längre. Ingen faktisk import är gjord.

# Skolimport i Phase 1

Underlagen finns endast lokalt i git-ignorerade `private-imports/`. De publiceras inte med appen. Sallys 24 lektioner följer användarens angivna tider (5+4+5+5+5); salar och terminsdatum har inte gissats. Neos underlag är tomt eftersom källbilden inte finns i den tillgängliga kontexten. Komplettera det från säkert avläst källa; använd null för okänd start/slut, aldrig uppskattade tider.

Formatet utgår från `docs/school-import.template.json`:

| Fält            | Format                                                                 |
| --------------- | ---------------------------------------------------------------------- |
| student_id      | `neo` eller `sally`, familjens kalenderprofil, inte privat UUID        |
| source          | Källbeskrivning för lokal granskning, lagras inte i kalenderns databas |
| term_start      | YYYY-MM-DD eller null i utkast; krävs vid import                       |
| term_end        | YYYY-MM-DD eller null i utkast; krävs vid import                       |
| exception_dates | Datum utan lektioner (lov/studiedagar)                                 |
| lessons         | Lista enligt nedan                                                     |

En lektion har `external_id` (stabilt ID), `weekday` (1 måndag–7 söndag), `starts_at`/`ends_at` (HH:mm eller null i utkast), `subject` och `room` (text eller null). Alla importerbara lektioner måste ha verifierade start- och sluttider. Tomt underlag eller okända tider kan förhandsgranskas men inte importeras.

1. Välj JSON-fil i kalenderns importdialog. Max 2 MB och 1 000 lektioner.
2. Granska elev, tider, ämnen och sal. Inga poster skickas ännu.
3. Ange bekräftad terminsstart och terminsslut; båda krävs. Lägg in kända lov och studiedagar. Utan undantag visas lektionerna även på lovdagar; appen gissar inte skolans ledigheter.
4. Kontrollera antal nya/uppdaterade poster och bekräfta uttryckligen att uppgifterna får delas med familjen. Ändrade uppgifter nollställer bekräftelsen.
5. Importen valideras både lokalt och i en transaktionell SQL-funktion. Konfliktmål `(student_id,external_id)` uppdaterar samma lektion utan dubbletter. En felaktig rad rullar tillbaka hela importen.

ID:n är knutna till källans lektionsslot, inte ämne eller tid, så ändrade tider/ämnen behåller samma ID. Sallys utkast använder stabila veckodag/slot-ID:n. Byt inte dem vid uppdatering av samma schemaplats. Saknade poster i senare filer **raderas inte** automatiskt. För att avsluta gamla lektioner: importera dem med ett bekräftat `term_end` före nya perioden, eller låt administratören radera specifika rader efter granskning. En import innehåller en aktuell definition per ID; historiska schemaversioner bevaras inte.

Importerade scheman expanderas i kalendern vid visning, inte som tusentals duplicerade kalenderposter. Tider är Europe/Stockholm och följer sommar-/vintertid. Kategorin Skola skiljs från Familj. Enskilda importerade lektioner ändras via ny import, inte via aktivitetens vanliga serieeditor.

Phase 0:s äldre `SchoolLesson`/UUID-format finns kvar för den privata modellen och dess regressionstester. Den nya öppna importen använder separata modeller/parser/tabeller; blanda inte dessa format.
