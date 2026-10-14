# Installera och registrera Familjen

## Android

1. Öppna https://tobisen.github.io/familjen/ i Chrome.
2. Välj Chrome-menyn → **Installera app** eller **Lägg till på startskärmen**.
3. Starta Familjen från hemskärmen. Välj Tobias, Neo eller Sally och ange den personliga inloggningskod som Tobias utfärdat. Registreringen finns även på https://tobisen.github.io/familjen/register/.
4. Sessionen sparas och förnyas automatiskt. Ingen återkommande kod behövs så länge sessionen är giltig och webbläsarens lagring finns kvar.

## iPhone

Öppna samma adress i Safari → Dela → **Lägg till på hemskärmen**. Starta den installerade appen och registrera där med din egen kod. Safari och installerad PWA kan ha separat lagring; registrera den miljö du tänker använda. Pushnotiser finns och aktiveras med telefonens behörighet.

## Trasig gammal Android-installation

Om Chrome säger ”redan installerad”, ”Det gick inte att öppna appen” och Familjen saknas i Androids applista: följ [Pixel 7 – WebAPK-felsökning och nytt installationstest](android-webapk.md). Cacheåterställning påverkar inte Androids paketregister. Börja med att uppdatera/tvinga avslut av Chrome och undersöka `chrome://webapks`, inte med att rensa alla Chrome-data.

Om webbappen i sig inte startar: `/familjen/recover/` → **Återställ appens cache** rensar bara appscopets statiska cache/service worker och behåller sessionen. **Visa teknisk kontroll** läser offentligt manifest/ikoner utan att ändra lagring.

Fristående starthjälp och återställning finns också under Inställningar och på registreringssidan. Uppdateringsbanderollen **Uppdatera appen** aktiverar en ny version utan att rensa autentiseringslagring.

## Personlig kod och byte av telefon

På en ny telefon används samma personliga kod. Kommandot nedan används endast
när administratören uttryckligen vill skapa eller byta en kod.

På administratörens Mac, i repositoryt, med befintlig Supabase CLI-kontoinloggning:

```sh
python3 scripts/create-device-codes.py neo
# eller alla tre:
python3 scripts/create-device-codes.py
```

Koden finns i `private-registration/neo-code.html` (motsvarande för Tobias/Sally). Överför privat till rätt person. Filerna är git-ignorerade och lokalt läsbara endast av ägaren. Publicera dem aldrig. Koden innehåller 80 slumpbitar, saknar tidsgräns och kan återanvändas. En uttryckligen utfärdad ny kod ogiltigförklarar tidigare koder för samma profil, men påverkar inte registrerade sessioner. Koden skrivs aldrig i URL eller frontendlagring; databasen innehåller bara hash.

Vid borttappad telefon: återkalla först användarens sessioner i Supabase Auth-administrationen och utfärda sedan en ny kod till den verifierade personen. Detta kan kräva ny registrering även på personens andra enheter. Ett redan utfärdat access-token kan gälla tills dess korta livslängd löper ut; om omedelbar spärr behövs, avaktivera profilens medlemskoppling administrativt under återställningen. Att bara utfärda en kod återkallar inte en förlorad telefons session. Ingen kan återställa åtkomst genom att bara välja ett namn. Glömd/rensad session återställs med samma personliga kod. Utfärda en ny kod endast vid kodbyte, glömd kod eller misstänkt läcka.

## Serverinstallation

Migration `202610130004_registration_codes.sql` och Edge Function `register-device` är installerade i Familjens separata projekt. Vid ny miljö: kör alla migrationer i ordning, provisionera de tre Auth-identiteterna och profilkopplingarna enligt [setup](phase1-setup.md), och kör:

```sh
npx supabase functions deploy register-device --project-ref DIN_PROJEKTREF --use-api --no-verify-jwt
```

Funktionen är avsiktligt nåbar före inloggning men ger ingen familjedata. Den kräver giltig personlig kod, kontrollerar den säkert på servern och utfärdar en riktig Supabase Auth-session. `redeem_device_registration` och tabellerna i `private` kan inte anropas/läsas av webbläsarroller. Funktionen använder Supabases inbyggda serverhemligheter; inga administrativa nycklar behövs i frontend. Vid annan domän måste funktionens tillåtna origins och appkonfiguration uppdateras.

Efter tio misslyckade försök för en profil eller tjugo för en IP under 15 minuter
spärras nya försök under kvarvarande tidsfönster. Felaktiga eller återkallade koder
ger samma generiska fel. Befintliga sessioner påverkas inte.

Migration 014 gör den senast utfärdade koden per profil återanvändbar utan tidsgräns,
även om den tidigare hade använts. Äldre ersatta koder förblir återkallade.
`used_at` används nu endast som tid för senaste lyckade kodkontroll;
`revoked_at` avgör explicit återkallelse. Koden kan användas igen på en ny telefon,
efter förlorad session eller efter ett tillfälligt Auth-fel. Sessionen sparas
fortfarande så att koden normalt bara behöver anges vid den första inloggningen.
