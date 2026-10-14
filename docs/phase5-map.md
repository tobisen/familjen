# Phase 5 – familjekarta och GPS

## Funktioner och uppdatering

Kartikonen i appens överkant öppnar Familjekartan; de fyra huvudflikarna är
oförändrade. Leaflet laddas först när kartvyn öppnas. Personmarkörer och en lista
visar familjens senaste positioner, personfärg, GPS-tid, serverns mottagningstid
och noggrannhet. Personknappar centrerar på markören och öppnar detaljer.
Knapp för egen position, familjeöversikt och stor kartvy finns.
Kartan anpassas första gången data visas; nya positioner flyttar inte en vy som
användaren själv navigerat. Popuptext byggs med DOM-textnoder, inte osäker HTML.

GPS-status visas vid kartikonen och i kartvyn. Ingen avstängningsknapp finns.
Telefonens behörighet styr alltid åtkomsten. När behörighet är okänd begärs den
endast genom användarens val **Tillåt plats**. Vid nekad behörighet ges instruktioner.

Efter autentisering startas en enda `watchPosition` om behörighet redan finns
och dokumentet är synligt. Bevakningen stoppas i bakgrunden och vid utloggning,
och återupptas vid återkomst. Äldre eller fördröjda callbacks kan inte överföras
till en ny session. Permissions API är valfritt; om webbläsaren inte kan läsa
behörigheten används den uttryckliga tillåt-knappen.

Batterival: normal bevakning använder `enableHighAccuracy: false`, högst
30 sekunders återanvändning av en GPS-avläsning och inga egna sekundpollningar.
En ny rapport skickas vid minst 75 meters rörelse, begränsad av avläsningarnas
noggrannhet, eller efter 60 sekunder med en ny aktuell avläsning. Klienten väntar
minst tio sekunder mellan rapporter; servern tillåter högst en var femte sekund.
En färsk avläsning hämtas också efter återanslutning. Senaste avläsningen
väntar i minnet om en sändning pågår eller tidsgränsen inte passerat, så att
rörelse inte tappas vid långsam anslutning. Kön töms bara i förgrunden och
rensas i bakgrunden, vid nekad behörighet och vid utloggning. Hjälp använder separat
hög noggrannhet och timeout. Gamla koordinater återstämplas aldrig som nya.

## Aktualitet

Ålder räknas från GPS-avläsningen, inte serverns mottagning:

- Under två minuter: **Nyligen uppdaterad**.
- Två till femton minuter: **Äldre position**.
- Över femton minuter: **Inaktuell position**.
- Ingen data: **Okänd position**.

Tid och noggrannhet visas alltid när position finns. Markörer ändrar också
utseende när de åldras. GPS är en uppgift från enheten; appen kan inte verifiera
att en browserrapporterad position motsvarar en faktisk fysisk telefon.

## Databas och säkerhet

Migration `202610140015_family_positions.sql` återanvänder `public.positions`
med en enda rad per autentiserad profil, och lägger till `received_at`.
`reported_at` är GPS-tid. `map_report` härleder familj och profil från Auth på
servern, validerar koordinater/noggrannhet/tid och gör en villkorad UPSERT.
En gammal avläsning eller alltför tät rapport ersätter aldrig den senaste raden.
Avläsningar äldre än två minuter eller mer än 30 sekunder i framtiden avvisas.
Flera enheter för samma profil delar dess senaste rad; nyaste giltiga GPS-tid vinner.

Direkt klientskrivning är återkallad. Authenticated SELECT skyddas av familje-RLS;
anon kan varken läsa koordinater eller anropa kartans RPC. Realtime publicerar
bara till behöriga familjemedlemmar. Snapshot hämtas om vid återanslutning och när kartan öppnas. En synlig kartvy
stämmer dessutom av serverdata var 30:e sekund som reserv om en
Realtime-händelse missas. Avstämningen ändrar aldrig GPS- eller mottagningstid
och använder ingen ny GPS-avläsning.
Inga koordinater sparas i localStorage, IndexedDB, service worker-cache eller
applikationsloggar. Senaste position finns endast i reaktivt minne och Supabase;
minnet rensas vid utloggning. Ingen separat positionshistorik skapas.

**Avsiktligt undantag:** ett bekräftat hjälpmeddelande innehåller koordinater och
GPS-tid i familjechatten, enligt uppdraget. Dessa finns kvar som en del av
meddelandet tills ägaren raderar det, då befintlig säker chattradering rensar texten.
Migration 017 använder en opak kartlänk med meddelande-ID. Koordinater hämtas
från det RLS-skyddade hjälpmeddelandet först efter autentisering; URL,
browserhistorik och pushkön innehåller inga koordinater. Hjälpmetadata rensas
också vid radering. Inga vanliga GPS-rapporter läggs i pushkön. Det är inte en
automatiskt samlad positionshistorik.

## Hjälp och push

**Be familjen om hjälp** försöker först hämta en ny GPS-avläsning. En dialog
visar färsk, gammal eller saknad position och kräver **Ja, skicka hjälpmeddelande**.
Utan GPS kan ett tydligt märkt meddelande skickas utan koordinater. Misslyckad
sändning behåller samma request-ID för återförsök. Servern deduplicerar och
begränsar nya hjälpmeddelanden till ett per minut och avsändare.

`map_help` använder befintlig `chat_send`, serverbestämda avsändare och
familjemottagare. Chattmeddelandet får `kind=help`, hög prioritet och en intern
kartlänk till positionen vid avläsningstillfället. Länken innehåller bara ett meddelande-ID. URL-fragmentet skickas inte
till Pages-servern. Pushkön sorterar hjälp först; Edge-worker skickar med
Web Push `urgency=high`. Själva notistexten innehåller inga koordinater.
Radering av hjälpmeddelandet återkallar dess ännu oskickade notiser.

`map_help_status` ger endast begränsad leveransstatus inom familjen, inga tokens
eller prenumerationsnycklar. Status visas efter sändning och på avsändarens
hjälpmeddelande i chatten, även efter en omladdning. Saknad notisenhet, köad
leverans och misslyckad leverans är tydligt skilda. Migration 016 markerar också
utgångna jobb som inte kunde levereras. Provideracceptans beskrivs
uttryckligen **inte** som bekräftad mottagning på telefonen. Fysisk leverans har
inte verifierats; telefonernas behörigheter och nätverk kan fördröja den.
Funktionen ersätter inte 112.

## Kartleverantör och plattformsgränser

[Leaflet API](https://leafletjs.com/reference.html) används med OSM:s standardtiles
via HTTPS och synlig OpenStreetMap-attribution. Endast synliga karttiles begärs,
med vanlig browser-cache enligt HTTP-header, ingen bulkprefetch eller egen
service worker-cache. Referrer-policy skickar origin utan privata sökparametrar.
Koordinater, namn eller identiteter skickas inte i separata leverantörsanrop.
Tileindexen avslöjar dock den visade kartregionen för leverantören, vilket är
oundvikligt med externa rastertiles. Detta är ingen tredjepartsanalysintegration.
Kartan/positionslistan hanterar misslyckad bakgrundskarta.

Källor: [OSM:s tilepolicy](https://operations.osmfoundation.org/policies/tiles/)
och [Geolocation watchPosition](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition).
OSM:s gratistiles har ingen leveransgaranti. Byt till en lämplig tillåten
leverantör om användningen senare växer.

PWA har ingen kontinuerlig bakgrunds-GPS. Service worker läser ingen GPS och
kringgår inga OS-behörigheter. Stängd app kan därför lämna en gammal position;
det visas alltid som sådan. Fysisk Android-/iPhone-verifiering återstår.

## Återanvändbara personliga koder

Migration `202610140014_reusable_codes.sql` gör senast utfärdade kod per profil
återanvändbar och utan tidsgräns, även om den använts före ändringen. Äldre
ersatta koder förblir återkallade. `revoked_at` styr uttryckligt kodbyte;
`used_at` är senaste lyckade kodkontroll. Samma kod kan användas på flera enheter
eller efter förlorad lokal session. Sessionerna sparas och förnyas fortfarande.

Koderna har 80 slumpbitar, lagras endast som hash på servern och omfattas av
befintlig begränsning av felaktiga försök. De är personliga autentiseringsuppgifter,
inte offentliga profilval. Utfärda en ny kod endast vid uttryckligt kodbyte:
`python3 scripts/create-device-codes.py neo`. Detta roterar den tidigare koden
men återkallar inte befintliga sessioner. Se [installationsguiden](installation.md).

## Verifiering och drift

Enhets-/SQL-tester täcker aktualitet, avstånd/noggrannhet, throttling, tidsgränser,
nekad behörighet, livscykel och sessionsbyte, idempotent hjälp, familjeisolering,
RLS och återanvändbara/revokerade koder. Mobil-E2E körs i Chromium och WebKit med
syntetisk GPS och lokala tile-fixtures. Detta är inte fysisk GPS-verifiering.

`scripts/live-map.mjs` körs endast med isolerade testfamiljer och tillfälliga
sessioner på stdin, utan loggning av tokens eller koordinater. Riktig Supabase-
lagring och Realtime mellan tre sessioner, GPS-rörelse, återanslutning, bekräftad
hjälp/chatt/kartlänk, saknade pushenheter och utloggning har verifierats. Två
registreringar med samma kod via hosted Edge Function och anonym/cross-family
RLS har också verifierats. Testfamiljerna städas med exakta ID:n.

Migrationerna 014–017 och uppdaterade `register-device`/`push-worker` är driftsatta
i Familjens separata Supabase-projekt. Befintlig VAPID, cron och Vault återanvänds;
inga nya hemligheter eller betaltjänster behövs.

Förslag inför Phase 6: vardagsflöden och tillförlitlighetsuppföljning efter
praktiska Android-/iPhone-test av GPS-behörighet, bakgrund/återkomst och push.
