# Phase 3 – familjechatt

Familjens tre registrerade profiler delar en privat chatt. Appen visar namn/personfärg, svensk tid, datumavdelare och egna meddelanden till höger. Meddelanden kan innehålla emojis och HTTP/HTTPS-länkar. HTML och Markdown tolkas inte; all användartext renderas som Vue-textnoder. Länkar öppnas med `noopener noreferrer`.

Endast avsändaren kan redigera eller radera ett meddelande. Redigering visas i tidsraden och använder versionskontroll. Radering tömmer texten och lämnar en markering i historiken. Historiken laddas i sidor om 40 meddelanden med serversekvens som cursor, utan offset. Äldre sidor ändras inte av nya meddelanden. Realtime levererar nya/ändrade meddelanden; efter återanslutning hämtas den laddade historikens intervall i sidor om högst 100 för att fånga missade ändringar.

## Läsning och mobilflöde

Startsidan visar senaste kvarvarande meddelandet, avsändare och antal olästa. Båda navigationerna har olästa-badge. Egna och raderade meddelanden räknas inte som olästa. Läsmarkering är per profil, gemensam över dess enheter, monoton och servervaliderad. Den uppdateras när chatten är synlig och användaren ser slutet. När äldre historik läses flyttas inte scrollen automatiskt vid nya meddelanden; en knapp leder till senaste meddelandet. Att öppna chatten visar slutet och markerar den hämtade historiken som läst.

Enter skickar på dator, Shift+Enter ger radbrytning och IME-komposition skickar aldrig av misstag. På pekskärm ger Enter radbrytning och skicka-knappen används. `visualViewport.resize` anpassar chatthöjden när tangentbordet påverkar den synliga ytan. Automatisk scroll sker vid öppning och när användaren redan är nära slutet. Äldre sidors scrollposition bevaras.

Misslyckade meddelanden ligger separat i minnet med tydlig felstatus och återförsök. Samma request-ID används vid återförsök, även om första skrivningen lyckades men svaret försvann. Serverns unika kombination av familj, avsändare och request-ID förhindrar dubbelsändning. En pågående identisk begäran kan inte skickas två gånger lokalt. Privata utkast/felmeddelanden sparas inte i service worker eller bestående offline-lagring och försvinner vid omladdning/utloggning. Nätverk krävs för att skicka.

## Databas och RLS

Migration `202610140007_family_chat.sql` är körd i det separata Familjen-projektet. Den utökar befintliga `chat_messages` och bevarar tidigare rader, kalender, listor, sessioner och registreringskoder.

- `chat_messages`: familjeskyddad SELECT, serversekvens, request-ID, version, redigerings- och raderingstid. RPC-only skrivning.
- `chat_read_states`: endast egen profil kan läsas; uppdateras via serveridentitet.
- `notification_preferences`: egen profils chattnotisinställning; kan inte användas för att ändra någon annans val.
- `private.chat_notification_events`: privat transaktionell kö med ett event per nytt meddelande, utan kopierad meddelandetext. Inga klientbehörigheter, inklusive för familjemedlemmar.

Alla nya tabeller har RLS. `chat_page`, `chat_summary`, `chat_send`, `chat_change`, `chat_mark_read`, `chat_preferences` kräver autentiserat och serverbundet familjemedlemskap. Mutationsfunktionerna har tom search_path, härleder avsändare/familj från `auth.uid()` och kontrollerar ägarskap på servern. Anonyma roller saknar tabell-/RPC-behörigheter. Direkta skrivningar är nekade även för autentiserade medlemmar. Meddelandetext begränsas till 10 000 tecken.

Sändningar låses kort per familj innan sekvens tilldelas; sekvensordning följer därmed commit-ordning även vid samtidiga sändningar. IDs är UUID och sekvensen är en separat unik bigint, begränsad till JavaScripts säkra heltal. Visning sorteras efter sekvens, aldrig telefonens klocka. Tidsstämplar skapas på servern och visas i Europe/Stockholm. Realtime-publicationen inkluderar chatt, egen lässtatus och notisinställningar. RLS styr leverans.

## Arkitektur

`src/domain/chat.ts` har modeller, sortering/deduplicering, säker länkdelning, svensk tidsformatering och tangentbordsregler. `src/data/chatRepository.ts` kapslar RPC/Realtime och tidsgränser. `src/stores/chat.ts` hanterar historik, status, prenumeration, återförsök och läsmarkering. `src/views/Chat.vue` är mobil-UI. Utloggning rensar data, pågående sändningar och kanaler; generationskontroll stoppar sena svar från en tidigare session.

Historik hämtas först när chatten öppnas. Övriga vyer hämtar bara senaste meddelandet, personer, olästa och notisval. Hela familjens historik hämtas alltså inte vid varje appstart.

## Phase 4 – säker pusharkitektur

Inga push skickas nu och inga behörighetsdialoger visas. Inställningen i chatten sparar endast önskemålet inför nästa fas.

1. En schemalagd eller serverautentiserad Edge Function läser privata köevent via en separat service-only claim-RPC som implementeras i Phase 4. Exponera inte `private`-schemat i PostgREST och tillåt inte anonym kökörning.
2. Arbetaren hämtar det aktuella meddelandet och familjens verifierade mottagare, deras lässtatus, notisval och säkert registrerade pushprenumerationer.
3. Hoppa över raderade meddelanden, avsändaren, oregistrerade profiler, avstängda notiser och redan lästa meddelanden. `_shared/chatNotifications.ts` förbereder och testar detta på serversidan; frontend importerar inte filen.
4. Använd en separat leveranstabell med unik nyckel per meddelande/mottagare/prenumeration, atomisk claim, begränsade återförsök och hantering av HTTP 404/410. VAPID-hemligheter får endast finnas i Edge Function secrets. Köeventens `processed_at` kan avsluta en behandling, men räcker inte ensam som leveransgaranti.
5. Notisklick leder till `https://tobisen.github.io/familjen/#/chatt`, där befintlig session och familjekoppling alltid verifieras. Skicka helst neutral notistext för att undvika privat innehåll på låsskärmen.

iOS kräver installerad PWA på iOS 16.4+ och behörighet från en aktiv användarhandling. Ingen leveransgaranti eller bakgrunds-GPS utlovas. Planera även framtida kalender-/uppgiftspåminnelser utifrån serverns datum och ansvariga, inte klienttimer.

## Verifiering och begränsningar

107 enhetstester och 40 E2E (30 appfunktioner + 10 PWA/appskal) passerar, tillsammans med lint, typecheck och build. Nya SQL-tester verifierar CRUD, ägarskap, versionskonflikt, cursorpaginering, läsmarkering, familjeisolering, idempotens och privat notiskö. Domän-/storetester täcker XSS-säker text/länkar, DST, tangentbord, utloggning/sena svar, återförsök och serverns notisurval. Mobil-E2E körs i Chromium och WebKit, inklusive minskad viewport, historik, olästa, edit/delete och förlorat serversvar.

Riktig Supabase-verifiering via `scripts/live-chat.mjs` omfattar tre separata sessioner för Tobias, Neo och Sally, nya meddelanden, egna/andras placering, redigering/radering, lässtatus, samtidiga sändningar, dubbelsändning, offline/återanslutning, session efter omladdning och nekad anonym åtkomst. `scripts/live-chat-rls.mjs` verifierar annan familj och oregistrerad Auth-användare. Dessa verifieringar körs sekventiellt så att syntetiska meddelanden inte stör varandras exakta olästa-räkning. Administrativ städning tar bara bort testernas exakta request-ID:n och temporära testidentiteter. Tokens lämnas via stdin och loggas inte.

Fysiska iPhone-/Android-installationer och deras verkliga tangentbord har inte testats. Failed-send/utkast är inte beständiga efter omladdning. Inga bilagor, sökning, skrivindikatorer eller läskvitton för andra personer ingår. Push och själva köarbetaren återstår till Phase 4.
