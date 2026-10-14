# Scheman, påminnelser, push och positioner

> Skolimport och kalender i Phase 1 beskrivs i [school-import.md](school-import.md) och [phase1-setup.md](phase1-setup.md). Nedanstående skolformat gäller den äldre privata Phase 0-modellen; aktuella pushfunktioner beskrivs i [Phase 4](phase4-push.md). GPS är fortsatt förberett.

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

Phase 4 är implementerad med den befintliga Workbox-workern och en importerad push-handler; inget byte av PWA-identitet eller cachemodell behövdes. Se [Phase 4: notifieringsregler, drift, säkerhet och verifiering](phase4-push.md).

## GPS

`readCurrentPosition` är förberedd adapter till browser Geolocation API, ännu inte kopplad till UI. Nästa fas ska kräva informerat aktivt val, säker inloggning och förgrundsläge. Spara bara senast rapporterad position med noggrannhet och tidsstämpel. Visa alltid hur gammal den är och erbjud att sluta dela/radera. Rapportera timeout, nekad behörighet och att plats är okänd. Ingen bakgrunds-GPS, ingen kontinuerlig spårning och inga livegarantier när appen stängs eller telefonen låses. Ingen extern karttjänst används i Phase 0.

## Fel och offline

`AsyncState<T>` beskriver loading, ready, error och unconfigured för kommande datalager. Implementerade datavyer använder tydliga laddnings- och fellägen. Statiskt appskal precachas; API-anrop och privat data finns inte i cache. Framtida offline-skrivningar kräver separat konflikt-, sekretess- och utloggningsmodell innan de aktiveras.
