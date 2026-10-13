# Scheman, påminnelser, push och positioner

> Skolimport och kalender i Phase 1 beskrivs i [school-import.md](school-import.md) och [phase1-setup.md](phase1-setup.md). Nedanstående skolformat gäller den äldre privata Phase 0-modellen; push/GPS är fortsatt förberedelser.

## Skolimport

`parseSchoolImport(unknown)` validerar JSON före framtida import. `docs/school-schedule.empty.json` är en tom mall, inga gissade lektioner. Varje lektionsrad ska innehålla:

| Fält                 | Format                                              |
| -------------------- | --------------------------------------------------- |
| external_id          | Stabilt ID från källa, oförändrat vid ändrade tider |
| student_id           | Profilens databas-UUID                              |
| weekday              | ISO-veckodag 1 (måndag) till 7 (söndag)             |
| starts_at, ends_at   | HH:mm, lokal tid Europe/Stockholm                   |
| subject              | Icke tom ämnestext                                  |
| room                 | Sal eller null                                      |
| term_start, term_end | YYYY-MM-DD, inklusive båda datumen                  |
| exception_dates      | Array med YYYY-MM-DD då lektionen inte inträffar    |

Klienten ska inte välja familj från otillförlitlig JSON. Importeraren tilldelar den autentiserade familjen. Upsert med konfliktmål `(family_id,student_id,external_id)` uppdaterar samma lektion utan dubbletter. Samma lektions-ID får finnas för olika elever. Källan måste leverera stabila ID:n; generera inte ID från tider/ämne. Avlägsnade lektioner kräver en explicit, transaktionell ersättningsimport för vald elev/termin, annars behålls de. Importkörning, diffgranskning och borttagningspolicy kommer i Phase 1. Vid ny termin ska käll-ID:n vara terminsunika. Validera hela importen innan någon rad skrivs. Hantera sommartid med IANA-zonen Europe/Stockholm när instanser skapas; veckolektioner är lokala tider, kalenderaktiviteter lagras som timestamptz.

## Web Push och påminnelser

Phase 0 levererar PWA service worker för statiska resurser, funktionsdetektion, tjänstekontrakt och subscription-tabell. Den registrerar inga pushprenumerationer och begär inga behörigheter. Nästa implementation behöver en egen push-handler i service worker (byt till injectManifest), en autentiserad registreringsendpoint, VAPID-nycklar och serverkod, exempelvis Supabase Edge Functions. VAPID privatnyckel förvaras i serverns hemlighetshantering. Pushendpoint/nyckelmaterial hanteras som känsliga uppgifter.

Serverstyrd scheduler med idempotent leveranslogg (aktivitet, mottagare, påminnelsetid), retries och hantering av utgångna prenumerationer krävs. Webbläsartimers fungerar inte som pålitliga påminnelser när appen är stängd. Uppdatering/radering av aktivitet måste ändra planerade jobb. Databasmodellen innehåller `reminder_minutes`; jobbkön byggs i senare migration. Ingen garanti om exakt leveranstid eller mottagning ges.

iOS/iPadOS 16.4 eller senare stöder push för appar installerade på hemskärmen. Begär notifieringsbehörighet efter aktiv knapptryckning i den installerade appen, aldrig automatiskt vid start. Förklara nekad behörighet och ge instruktioner för inställningar. Även Android kräver användarens godkännande och feature detection. Källa: [WebKit: Web Push on iOS/iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

## GPS

`readCurrentPosition` är förberedd adapter till browser Geolocation API, ännu inte kopplad till UI. Nästa fas ska kräva informerat aktivt val, säker inloggning och förgrundsläge. Spara bara senast rapporterad position med noggrannhet och tidsstämpel. Visa alltid hur gammal den är och erbjud att sluta dela/radera. Rapportera timeout, nekad behörighet och att plats är okänd. Ingen bakgrunds-GPS, ingen kontinuerlig spårning och inga livegarantier när appen stängs eller telefonen låses. Ingen extern karttjänst används i Phase 0.

## Fel och offline

`AsyncState<T>` beskriver loading, ready, error och unconfigured för kommande datalager. Alla nuvarande datavyer visar tydligt att de inte är aktiverade. Statiskt appskal precachas; API-anrop och privat data finns inte i cache. Framtida offline-skrivningar kräver separat konflikt-, sekretess- och utloggningsmodell innan de aktiveras.
