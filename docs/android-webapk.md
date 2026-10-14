# Pixel 7: Chrome säger redan installerad men kan inte öppna appen

## Bedömning

Pixel 7 kör **Android 17 och Chrome 155.0.8059.41**, med andra installerade WebAPKs på samma origin, bland annat `/dejter/` och Vinskåpet. Webbappen/genvägen fungerar, men Chrome säger ”redan installerad”, Öppna misslyckas och Familjen saknas i Androids applista.

**Identifierat versionsspecifikt Chrome-fel:** i exakt tagg `155.0.8059.41` anropar installationsdialogen `WebappRegistry.isAppInstalledForUrl(currentTab.getUrl())`. Den funktionen kontrollerar endast om någon installerad WebAPK finns på samma **origin**, via `hasAtLeastOneWebApkForOrigin`, inte om appens **scope** omfattar Familjens URL. Öppna-knappen söker däremot paket efter manifest-ID eller den aktuella adressen. Om bara syskonappar är installerade ger dialogen därför falskt ”redan installerad”, följt av `open_webapk_failed` när inget Familjen-paket hittas. Det är en konkret kodförklaring som matchar användarens miljö; en stale Familjen-post behöver inte finnas alls.

Chromiums granskade main har ersatt detta med scope-medveten `hasInstalledWebApkForUrl` och hänvisar till `crbug.com/568841400`. Rättningen finns inte i den granskade 155.0.8059.41-taggen. Det är inte verifierat vilken distribuerad Chrome-version som först innehåller den eller att den körda telefonens process gått exakt denna kodväg; fysisk verifiering återstår. **Byt inte Familjens identitet och rensa inte sessioner som lösning på samma-origin-felet.**

En separat faktisk paket-/registerskada är fortfarande möjlig om diagnostiken visar ett Familjen-paket som inte går att starta. Då gäller den villkorade paketåterställningen nedan.

En WebAPK är ett Android-paket separat från webbsidans service worker och cache. JavaScript kan varken läsa hela Chromes interna paketregister eller avregistrera/avinstallera en WebAPK. **Återställ appens cache** reparerar därför inte automatiskt ett saknat Android-paket. Den fungerande vanliga genvägen är en rimlig tillfällig användning av appen, men bevisar inte lyckad WebAPK-installation.

Ingen telefon var ansluten till tillgänglig ADB vid granskningen. Automatiserade Chromium-/WebKit-tester är inte verifiering på fysisk Pixel.

## Identitets- och kodgranskning, 2026-10-14

| Commits                         | Manifest/start/scope                                                        | Effektiv identitet                                            |
| ------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `f852712`, `b5f22ac`, `6471c15` | `/familjen/manifest.webmanifest`, start `./`, scope `./`, inget explicit id | `https://tobisen.github.io/familjen/` enligt start_url-regeln |
| `46c748b` och senare            | Samma manifestfil, id/start/scope `/familjen/`                              | Samma URL                                                     |

Namn, short_name och display har varit oförändrade sedan Phase 0. Ikonernas innehåll har inte ändrats; relativa ikon-URL:er blev absoluta under samma `/familjen/`. Alla PNG-filer finns, har rätt MIME-typ och deklarerade 192/512-dimensioner. Manifest/start/SW/ikoner svarar HTTP 200 utan annan destinationsadress. Vue Router har fortsatt hashhistorik och bas `/familjen/`; interna direktlänkar kräver inga Pages-omskrivningar. `/register/` och `/recover/` har riktiga HTML-filer. Service worker har samma scope, promptstyrd uppdatering och versionshashad precache. Manifest och Supabase-data har ingen runtime-cache.

Tidiga relativa Workbox-fallbacken korrigerades redan i `46c748b`. Granskningen hittar inget nytt manifest-/routerfel som förklarar att Android inte kan öppna ett saknat paket. Det går inte att fastställa telefonens historiskt beräknade identitet enbart från repositoryt; jämför därför telefonens Manifest Id och Scope mot tabellen.

**Ingen identitet, start-URL, scope eller manifestfil har bytts i detta uppdrag.** Det skulle kunna skapa en extra installation och dölja felet.

Identifierade förbättringar: återställningshjälpen skiljer nu mellan webbcache och WebAPK. Cacheurvalet kräver exakt appscope i cache-namnet, så appar under andra eller nästlade scopes på samma origin bevaras. Ny skrivskyddad teknisk kontroll läser manifest, ikonstatus och eget SW-scope, aldrig Auth-lagring, URL-fragment, koder eller privata familjedata. Den anger uttryckligen att Androids WebAPK-status är okänd från webbsidan.

## Första testet för just Chrome 155.0.8059.41

1. Låt Vinskåpet och Dejter vara installerade. Rensa inga webbplatsdata och ändra inga Chrome-flaggor.
2. Öppna `https://tobisen.github.io/familjen/` i vanlig Chrome och välj appens **Uppdatera appen** om banderollen visas. Ladda sedan om.
3. Öppna Familjen → Inställningar → **Hjälp med installation och start**. Om enheten inte är registrerad finns samma avsnitt under **Problem att öppna eller installera appen?** på registreringssidan.
4. Om **Installera Familjen** visas, tryck på den och bekräfta Chromes installationsdialog. Knappen använder den sparade `beforeinstallprompt`-händelsen direkt, i stället för Chromes felaktiga Universal Install-meny. Det är samma manifest och app-ID. Chrome bestämmer om händelsen erbjuds; knappen kan därför saknas även när konfigurationen är korrekt.
5. Kontrollera att Familjen faktiskt finns i Androids applista och startar från hemskärmen. ”Installationsbegäran skickad” eller `appinstalled` är inte verifiering av fungerande appstart.
6. Om knappen saknas eller installationen misslyckas: behåll genvägen och uppdatera Chrome när en rättad version erbjuds i Play Butik. Anteckna installerad version och prova samma manifest igen. Ingen viss versionsgräns eller fungerande Pixel-installation påstås här.

Detta är ett riktat alternativ att prova, inte en verifierad fysisk workaround. Webbappen kan inte rätta Chromes egen origin-/scope-kontroll.

## Paketdiagnostik och återställning – utan att rensa Chrome-data

1. **Anteckna versionerna före ändring.** Chrome → ⋮ → Inställningar → Om Chrome. Android → Inställningar → Om telefonen → Android-version. Använd vanlig Chrome och samma Android-användare/profil som när felet uppstod; kontrollera om Chrome Beta/annan webbläsare eller arbetsprofil också finns.
2. **Uppdatera och starta om rätt process.** Uppdatera Chrome i Play Butik. Stäng Familjen-flikar/fönster. Android → Inställningar → Appar → Visa alla appar → Chrome → Tvinga avslut. Öppna Chrome igen. Välj inte Rensa lagring/Radera data. Detta kan avsluta en fastnad installation i processminnet utan att radera sessioner.
3. **Öppna startsidan direkt.** Skriv `https://tobisen.github.io/familjen/`, inte en gammal sökträff eller annan apps adress. Kontrollera att din profil återställs. Öppna gärna `/familjen/recover/` → **Visa teknisk kontroll**; id/start/scope ska sluta i `/familjen/` och ikoner ska ha status 200. Kontrollen säger inte om APK finns.
4. **Öppna intern diagnostik manuellt.** Skriv `chrome://webapks` i adressfältet (alternativt `about://webapks`). Dessa interna sidor öppnas inte säkert via vanliga webblänkar. Sök efter Familjen och anteckna Package name, Scope, Manifest URL, Manifest Start URL, Manifest Id, Owning Browser och Update Status. Förväntad Manifest URL är `https://tobisen.github.io/familjen/manifest.webmanifest`, Scope/Start/Id är `https://tobisen.github.io/familjen/`. Kontrollera också andra appar på `tobisen.github.io`, särskilt scope `/` som överlappar alla projekt.
5. **Om rätt paket finns:** Android → Inställningar → Appar → Visa alla appar, använd sökningen och vid behov Visa systemappar. Leta efter namnet från WebAPK-sidan, inte bara genvägens text. Om rätt Familjen-paket hittas: avinstallera endast det paketet, välj inte att rensa webbplatsdata om en sådan extrafråga visas, starta om Chrome och installera på nytt. Ta inte bort Vinskåpet eller andra appar för att gissa fram en lösning.
6. **Update är ingen unregister-knapp.** Om WebAPK-posten har en Update-knapp kan den begära en uppdatering. Googles dokumenterade flöde kräver normalt laddare, Wi-Fi, att appen startas och sedan stängs. Om appen inte kan starta och Android inte hittar paketet går det inte att lova att Update kan återställa det. Den granskade `chrome://webapks`-koden erbjuder ingen allmän Remove/Unregister-knapp.
7. **Om inget paket finns eller felet består:** starta om Pixel och testa startsidan igen. Chrome → ⋮ → **Installera och skapa genväg → Installera**, eller **Installera app** beroende på version. Välj själva installationen, inte **Skapa genväg**. Om ”redan installerad” består trots saknat paket: stanna här med den fungerande genvägen och behåll diagnostiken. Detta måste då hanteras som ett Chrome-/Android-fel; webbappen kan inte tvinga fram registerreparation.

Lyckat test betyder att Familjen syns under Androids appar, att hemskärmsikonen startar den självständiga appen, att profilen återställs och att kalender/listor/chatt fungerar efter att appen stängts och öppnats igen. Testa därefter en vanlig webbläsarflik och en appuppdatering. En genväg som bara öppnar Chrome räknas inte som verifierad WebAPK-installation.

## Riktad reservåtgärd med större påverkan

**Rekommenderas inte för den identifierade Chrome 155-förväxlingen.** Den rättar inte origin-/scope-buggen och kan logga ut andra appar i onödan. Avsnittet gäller en separat konstaterad lokal dataskada efter att paket-/versionsdiagnostiken gjorts.

Om processen ovan inte hjälper och du accepterar ny registrering kan du prova Chrome → Inställningar → Webbplatsinställningar → Alla webbplatser → `tobisen.github.io` → **Rensa och återställ** (ordalydelse varierar). Kontrollera domänen innan bekräftelse. Detta rensar inte alla Chrome-webbplatser, historik eller hela Chrome-installationen, **men rensar lokal webbplatslagring/sessioner för hela `tobisen.github.io`, även Vinskåpet och andra appar där**. Förbered därför nya personliga koder. Serverlagrad familjedata försvinner inte. Exportera inte refresh tokens för att försöka rädda sessionen.

Chromium har separat kod för filtrerad avregistrering av webbappar när typen WEB_APP_DATA rensas. Det betyder inte att varje versions UI-knapp för webbplatsdata säkert rensar en felaktig WebAPK-post. Denna reservåtgärd är alltså inte en garanterad reparation. Rensa inte alla Chrome-data, avinstallera Chrome eller ändra Familjens manifest-ID som nästa gissning.

## Valfri exakt paketdiagnostik med USB/ADB

Om Pixel kan anslutas till administratörens Mac: aktivera USB-felsökning, godkänn datorn och läs först:

```sh
adb devices -l
adb shell pm list packages --user 0 org.chromium.webapk
adb shell pm list packages -u --user 0 org.chromium.webapk
```

`-u` inkluderar även paket som finns kvar registrerade men inte är installerade för användaren. User 0 gäller huvudprofilen; anta inte att en arbetsprofil har samma användar-ID. Koppla ett paket till Familjen via exakt Package name och Manifest URL från `chrome://webapks`. Om paketet saknas finns inget identifierat paket att avinstallera. Använd inte wildcard-uninstall och avinstallera inte ett paket bara för att det börjar med `org.chromium.webapk`.

När rätt paket är identifierat kan en tekniker öppna dess appinformation med `adb shell am start -a android.settings.APPLICATION_DETAILS_SETTINGS -d package:EXAKT_PAKETNAMN`. Avinstallera bara det bekräftade Familjen-paketet där. Detta kräver fysisk åtkomst/USB-godkännande och har inte utförts i den aktuella felsökningen.

## Underlag om felet kvarstår

Chrome-/Android-version, steg som provats, exakta feltexten, vad `chrome://webapks` visar och om paketet finns via Android/ADB. Rapportera även andra WebAPK-scopes på samma origin. Skicka inga sessionstokens, engångskoder eller privata meddelanden. Chrome → Hjälp och feedback → Skicka feedback är lämplig väg för ett kvarstående lokalt paket-/registerfel.

## Källor och verifiering

- [Exakt Chrome 155.0.8059.41: WebappRegistry.java](https://chromium.googlesource.com/chromium/src/+/155.0.8059.41/chrome/android/java/src/org/chromium/chrome/browser/webapps/WebappRegistry.java), särskilt `isAppInstalledForUrl` och `hasAtLeastOneWebApkForOrigin`.
- [Exakt Chrome 155.0.8059.41: AppInstallMenuHandler.java](https://chromium.googlesource.com/chromium/src/+/155.0.8059.41/chrome/android/java/src/org/chromium/chrome/browser/webapps/AppInstallMenuHandler.java), särskilt `doUniversalInstall` och `doOpenWebApp`.
- [Chrome: eget installationsflöde med beforeinstallprompt](https://web.dev/articles/customize-install).

- [Chrome: PWA-identitet och implicit id](https://developer.chrome.com/docs/capabilities/pwa-manifest-id).
- [Google: WebAPK-uppdatering på Android](https://web.dev/articles/manifest-updates).
- [Google: installation/avinstallation av webbappar](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid).
- [Chromium WebappRegistry](https://github.com/chromium/chromium/blob/main/chrome/android/java/src/org/chromium/chrome/browser/webapps/WebappRegistry.java): registrering, pending-installationer, paketkontroll och URL-scope. Aktuell main refererar `crbug.com/568841400` vid scope-matchning för flera WebAPKs på samma origin. Jämförelsen mot exakt 155.0.8059.41 visar att den granskade taggen saknar denna scope-rättning.
- [Chromium WebAPK-diagnostik](https://github.com/chromium/chromium/blob/main/chrome/browser/resources/webapks/about_webapks.ts): visar paket/manifest och erbjuder Update, ingen generell unregister-knapp.
- [Chromium filtrerad webbapprensning](https://github.com/chromium/chromium/blob/main/chrome/browser/browsing_data/chrome_browsing_data_remover_delegate.cc).

117 enhetstester och 46 E2E passerar, liksom lint, typecheck och produktionsbuild. Installationshändelser i E2E är simulerade browser-events; de bevisar inte en fysisk WebAPK-installation.

Automatiserade kontroller skyddar identitetshistorik, manifestlänk från alla entréer, faktiska PNG-dimensioner/avkodning, säkra cachegränser, sessionbevarande och skrivskyddad diagnostik. Auth, kalender, listor, chatt och PWA regressionstestas. Den exakta körvägen på fysisk Pixel och lyckad ominstallation återstår att verifiera med stegen ovan.
