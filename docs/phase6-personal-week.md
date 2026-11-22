# Phase 6 – Min vecka

Privat veckoplanering via profilnära anteckningsikon och hash-routen
`/familjen/#/min-vecka`. De fyra huvudflikarna behålls. Inga kalenderhändelser,
familjeuppgifter eller notiser skapas av den privata planeringen.

## Import från ChatGPT-projektet Livet

Utgå från [JSON-mallen](personal-week.template.json). Be om en ISO-vecka med
formatet nedan. Kopiera resultatet, öppna Min vecka → Importera vecka, klistra in,
validera, granska dagskort och sammanfattning och bekräfta. Förhandsgranskning
sparar ingenting. Vanlig JSON och detta omslag fungerar:

```text
--- FAMILJEN WEEK IMPORT ---
{ "year": 2026, "week": 53, "weekType": "barnfri" }
--- END ---
```

Obligatoriskt: `year` (heltal 2000–2100), `week` (giltig ISO-vecka 1–53),
`weekType` (`barnvecka`, `barnfri`, `specialvecka`). ISO-veckoåret kan skilja sig
från kalenderåret: 1 januari 2027 hör till 2026 vecka 53.

Även ChatGPT-format med ett samlat `week`-objekt fungerar:

```json
{
  "week": {
    "year": 2026,
    "weekNumber": 48,
    "type": "barnvecka",
    "focus": ["Balans"]
  },
  "days": [
    {
      "date": "2026-11-23",
      "day": "måndag",
      "work": "Arbetsdag",
      "food": "Middag"
    }
  ],
  "weekTasks": [{ "category": "economy", "task": "Stäm av budget" }]
}
```

Använd antingen veckofält på översta nivån eller `week`-objektet. Dubblerade
alias avvisas så att ingen version av informationen väljs bort tyst.

Valfria fält:

- `focus`: högst tio texter, vardera 1–80 tecken.
- `days`: högst sju unika datum i veckan. Utelämnade dagar skapas tomma.
  `date` anges som YYYY-MM-DD. Valfri `weekday` (eller `day`) är ISO-tal 1–7 eller svensk
  veckodag, och måste stämma med datumet. `priority`: `low`, `normal` (standard),
  `high`.
- Varje dag kan ha `work`, `training`, `food`, `home`, `family`, `social`, `other`,
  `selfCare`, `recovery`, som listor med 0–20 texter (1–2000 tecken), en enskild text eller `null`.
  Tom text, `null` och tom lista betyder ingen post.
  `food` mappas till databasens `meal`. Samma listor kan ligga under `categories`.
- `items`: lista med `{ "category": "training", "content": "Promenad", "done": false }`.
  Tillåtna kategorier är `work`, `training`, `meal`, `home`, `family`, `social`,
  `other`, `selfCare`, `recovery`; `food` accepteras som alias för `meal`.
  Högst 90 poster sammanlagt per dag. `done` är valfri boolean, standard false.
- `weeklySummary`: objekt med valfria texter `trainingGoal`, `foodPlan`,
  `socialPlan`, `recovery`, `economy`, `reflection`, högst 3000 tecken per fält.
- `weeklyTasks` (eller `weekTasks`): högst 100 uppgifter som texter eller objekt
  `{ "category": "home", "task": "Boka tid", "done": false }`.
  Texten är 1–1000 tecken. Standardkategori `other`, standard `done: false`.
  Veckouppgifter stöder dessutom kategorin `economy` (Ekonomi).
  Identiska uppgifter i samma kategori avvisas.

Även normaliserade fältnamn `week_number`, `week_type`, `weekly_summary`, `tasks`
accepteras. Använd endast ett namn för varje aliaspar. JSON begränsas till
200 000 tecken. Okända metadatafält ignoreras; felaktiga kända fält avvisas med
fältets sökväg. Importerade ID:n eller ägarfält används aldrig som identitet.
En import är en hel veckoplan. Vid befintlig vecka krävs ett uttryckligt val att
ersätta; annars behålls planen. Tidigare redigeringar och avbockningar kan då
försvinna. Det är inte en sammanslagning av två veckor.

## Data, säkerhet och samtidig redigering

Migration `202611220001_personal_weeks.sql` skapar:

- `personal_week_owners`: adminstyrd behörighetskoppling till en befintlig profil.
  Migrationen kräver exakt en befintlig Tobias-profil och kopierar dess stabila
  UUID. Inga nya Auth-identiteter skapas. Profilnyckeln används endast vid
  provisionering, inte som löpande auktorisation eller namnkontroll.
- `personal_weeks`: unik ägare + ISO-år + vecka, veckotyp, fokus, JSONB-sammanfattning,
  versionsnummer och idempotensuppgifter.
- `personal_week_days`: unikt datum per vecka och prioritet.
- `personal_day_items`: kategori, text, ordning och status.
- `personal_week_tasks`: kategori, uppgift, ordning och status.

Samtliga planrader har skapad/uppdaterad-tid. Sammansatta foreign keys verifierar
ägaren genom vecka → dag → post. Index stöder datum, kategori och status.
RLS och tabellrättigheter låter endast den provisionerade profilens aktuella
Auth-koppling läsa planrader. Direkt skrivning är nekad även för ägaren, enligt
repots RPC-mönster. `personal_week_save` verifierar Auth → profil → behörighet,
härleder `owner_id` på servern och avvisar en annan angiven ägare. Neo och Sally
har ingen behörighetskoppling. Lokal profil, namn eller JSON kan inte ge åtkomst.
Route-guard och profilnära ikon använder serverns `personal_week_owner`.

Import, ersättning, checkboxar och formulär använder samma validerade transaktion.
En vecka låses per ägare/år/vecka. En befintlig vecka kräver exakt versionsnummer;
NULL betyder endast nyskapande. Konflikter visas med instruktion att hämta senaste.
Samma request-ID och innehåll kan återförsökas utan nya rader. Återanvändning med
annat innehåll nekas. Dag-ID:n behålls vid import. Vid manuell redigering behålls
post- och uppgifts-ID:n samt skapad-tid. En misslyckad transaktion rullas helt tillbaka.

Data hämtas från Supabase vid navigation, omladdning och återgång till appfönstret
när ingen dialog är öppen. Det finns ingen offlinekö eller särskild Realtime-kanal
för privata veckor. Samtidiga ändringar skyddas av versionskontroll. Ingen avancerad
statistik implementeras; schema och status lämpar sig för framtida historik.

## Verifiering

Domäntester täcker markörer, storlek, kategorimappning, valfria fält,
textgränser, felvägar, dubbletter och ISO-årsskiften. SQL-tester kör alla riktiga
migrationer i PGlite med separata Auth-identiteter och kontrollerar rättigheter,
RLS, förfalskat ägarskap, foreign keys, rollback, idempotens, versionskonflikter,
redigering, ordning och checkboxar. Playwright kör import, bekräftad ersättning,
redigering, navigation och privat åtkomst i Pixel 7/Chromium och iPhone/WebKit.

Operatörstestet `scripts/live-personal-week.mjs` tar kortlivade testlänkar och
publik klientkonfiguration via stdin. Inga administrativa nycklar behövs i
frontend eller testskriptet. Det ska endast köras mot Familjens projekt. Dess
fiktiva framtidsvecka tas bort av operatören efter körningen.

[Resultat från lokal och riktig Supabase-verifiering](phase6-verification.md).

Kompatibilitetsmigration `202611220002_personal_week_import_compatibility.sql`
tillåter `economy` för veckouppgifter. Dagarnas kategorier, RLS och ägarverifiering
behåller samma regler. Regressionstester använder ett syntetiskt ChatGPT-exempel;
personliga veckoplaner läggs inte i det publika repot.
