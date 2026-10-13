# Familjens säkerhetsmodell – Phase 1.5

Familjedata kräver Supabase Auth och serverregistrerat medlemskap. GitHub Pages distribuerar enbart appskal och offentlig klientkonfiguration. Profilpreferens i localStorage är aldrig ett åtkomstbevis. SDK lagrar en signerad Auth-session separat; servern verifierar JWT och RLS härleder familj från `auth.uid()`.

Phase 1:s tidigare publika kalender är avvecklad genom migration 003. Inga publika läs-/skrivpolicyer finns kvar. Gamla `public_calendar_*`-RPC:er och `open_calendar_enabled()` är borttagna. En gammal frontend kan därför inte fortsätta läsa eller skriva kalenderdata anonymt.

Alla 14 familjetabeller skyddas med RLS och nekad anon-åtkomst. Authenticated utan provisionerat medlemskap får ingen familjedata. Profiler/familjer får endast administreras från betrodd SQL/Admin API. Personliga registreringslänkar kan inte provisionera medlemskap; de autentiserar redan administrativt kopplade identiteter.

Kalenderns security definer-RPC:er kontrollerar familj explicit, binder varje ändring till serverprofil och filtrerar rad-ID inom den familjen. Optimistiska versioner förhindrar tysta överskrivningar. Direkta kalenderwrites är nekade. Samma textnyckel `neo` kan finnas i två familjer, men kombinerade nycklar och familjefilter förhindrar korskoppling. Phase 0:s privata deltagar-/profil-FK och ägarpolicyer för chatt, GPS och push är kvar.

Service worker cachar endast statiska resurser, inte Auth/API/data. Registreringsfragmentet rensas före navigation, och token används först efter aktiv registreringsknapp. Utloggning stänger kanaler och rensar all laddad kalenderdata; generationskontroll avvisar sena svar. En annan lokal profil kan aldrig byta registrerad identitet.

Se [aktuell setup, registrering och återkallning](phase1-setup.md). Testbevis och faktisk live-status redovisas i Phase 1.5-verifieringen.
