> Historik från Phase 1. Phase 1.5 återinför privat kalender och personlig registrering; se phase1-setup.md.

# Phase 1 arbetsplan

1. Återanvänd Vinskåpets separata domänfunktioner, repository-lager, reaktiv store och enda Supabase-klient. Återanvänd inga nycklar, projekt eller data. Familjen använder OTP i stället för lösenord.
2. Migrera kalendern till transaktionella RPC:er, serverbestämd identitet, versionskontroll och familje-RLS.
3. Implementera dag/vecka/månad, deltagare, heldag, daglig/veckovis/månadsvis återkomst med slutdatum och undantag, detalj/CRUD och Realtime.
4. Implementera privat JSON-förhandsgranskning och atomisk skolimport med stabila ID:n. Skapa ej publicerade underlag; terminsdatum måste bekräftas.
5. Verifiera domän, DST, RLS, import, UI och regression. Dokumentera externa steg, committa, pusha och verifiera Pages.

Externa förutsättningar: separat Supabase-projekt och administrativ anslutning, verifierbara inloggningskanaler, bekräftade terminsdatum och Neos källbild. Lokalt arbete fortsätter utan dessa. Ingen testinloggning eller lokal kalenderbackend aktiveras i produktionsbygget.

## Senare användarbeslut

Användaren bekräftade uttryckligen offentlig kalender även för redigering av alla med adressen. Kalendern använder därför en separat öppen modell utan Auth, medan privata Phase 0-tabeller behåller sina behörigheter. Ingen falsk autentisering kopplas till lokal profil. Skolscheman får gälla varje vecka tills manuell uppdatering; startdatum och offentlig publicering bekräftas i importvyn, slutdatum är valfritt.
