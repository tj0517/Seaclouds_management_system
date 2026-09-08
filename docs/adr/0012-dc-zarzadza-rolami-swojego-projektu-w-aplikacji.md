# ADR-0012 — DC zarządza rolami swojego projektu także w aplikacji, nie tylko w RLS

## Kontekst

1a.09 dodał politykę `"Doc controllers manage project roles"` na
`dcs.project_roles` (`is_doc_controller(project_id)`, `FOR ALL`) — od tego
momentu baza dopuszcza, żeby DC projektu zarządzał rolami tego projektu bez
bycia adminem. Server actions `grantProjectRole`/`revokeProjectRole`
(1a.06, `apps/dcs/lib/project-roles.ts`) tego nie odzwierciedlały: ich guard
(`requireAdmin`) wpuszczał wyłącznie `profiles.role = 'admin'`, więc
aplikacja była węższa niż polityka — zapisana rozbieżność w
`docs/deferred-tasks.md` (q), z jawną notatką, żeby poszerzyć guard "razem z
ekranem macierzy ról, zadanie 1a.14 — nie wcześniej, bo nic jeszcze nie woła
tej akcji". 1a.14 (ekran macierzy user × project × role) jest pierwszym
wywołującym z UI, więc jest właściwym miejscem na tę decyzję.

Alternatywa rozważona i odrzucona: zostawić `grantProjectRole`/
`revokeProjectRole`/nowy `setProjectRoles` na `requireAdmin` (tylko admin
zmienia role z UI), a DC dać wyłącznie odczyt. To zawęziłoby zachowanie
aplikacji względem tego, co RLS już świadomie dopuszcza od 1a.09 — poprawka
polityki bez poprawki guardu (albo odwrotnie) to dokładnie rozbieżność, którą
CLAUDE.md każe unikać ("Każda uprzywilejowana akcja serwerowa sprawdza
autoryzację w aplikacji ORAZ polega na RLS").

## Decyzja

Server-side guard (`requireAdminOrDc` w `apps/dcs/lib/project-roles.ts`,
używany przez `grantProjectRole`, `revokeProjectRole` i nowe
`setProjectRoles`) wpuszcza **admina globalnego (`profiles.role = 'admin'`)
LUB DC danego projektu (`dcs.project_roles` z `role = 'dc'` dla tego
`project_id`)** — dokładnie te same dwa przypadki, co polityki RLS
`"Admins manage project roles"` i `"Doc controllers manage project roles"`.
Zamyka to punkt q) z `docs/deferred-tasks.md`.

Konsekwencja UI (1a.14): ekran "per user" (`/admin/users/[userId]`) zostaje
**admin-only** (macierz obejmuje wszystkie projekty naraz, jak w Timesheet
`admin/users/[id]`, gdzie project lead też jest przekierowywany) — DC nie ma
tam żadnej naturalnej granicy scope'u, bo strona nie jest przypięta do
jednego projektu. Ekran "per project" (`/admin/projects/[projectId]`) jest
**edytowalny dla admina LUB DC tego projektu**, tak jak `requireAdminOrDc` —
DC innego projektu ani zwykły członek zespołu nie widzi tam przycisków akcji
(read-only), co odzwierciedla `apps/dcs/components/IfRole.tsx`, tyle że tu
decyzja jest liczona wprost w RSC, bo dotyczy całej strony, nie jednego
przycisku.

## Konsekwencje

- `docs/deferred-tasks.md` (q), pierwszy punkt: zamknięty, patrz 1a.14.
- DC projektu P nadal nie może niczego zmienić na projekcie Q — ani przez
  RLS (niezmienione od 1a.09), ani przez guard aplikacji (sprawdza
  `project_id` z inputu, nie globalny status DC). Dowiedzione w
  `supabase/tests/project_roles_matrix.test.sql` (czerwony przebieg
  potwierdzony ręcznie przy review) i wcześniej już w
  `rls_project_role_functions.test.sql` (1a.09) na poziomie samej bazy.
- **Nieodwrócone tym ADR-em, zapisane w deferred-tasks.md (q) jako osobny
  punkt**: DC może odebrać sobie własną rolę `dc` na projekcie i stracić
  dostęp — baza na to pozwala (polityka jest per wiersz, nie ma reguły
  "ostatni DC"), a ekran tego nie blokuje. Świadomie odłożone do decyzji
  produktowej, nie część tego ADR-u.
- `public.profiles` SELECT (`auth.uid() = id OR is_admin()`) jest
  niezmienione — DC czytający `/admin/projects/[projectId]` widzi role
  swojego zespołu, ale nie zawsze ich imiona i nazwiska (RLS na `profiles`
  wpuszcza tylko własny wiersz albo admina); ekran degraduje się do
  wyświetlenia skróconego `id`. Osobny punkt w `docs/deferred-tasks.md`
  (follow-upy 1a.14) — nie jest to zmiana schematu ani polityki, więc nie
  wymagała tego ADR-u.
- **Ta decyzja pierwszy raz aktywuje bramkę aal2 w `apps/dcs/proxy.ts`
  (1a.11) na produkcji** — do tego zadania `apps/dcs` nie miało żadnej
  trasy `/admin*`, więc kod bramki był martwy (odnotowane w
  `docs/deferred-tasks.md` (v)). Sprawdzone na żywo na scl-dev 2026-09-08
  (dwa konta testowe, zero istniejących faktorów TOTP każde): trafienie w
  `/admin/...` bez aal2 to **przekierowanie na `/mfa` z samoobsługowym
  zapisem (QR + kod), nie twardy blok** — konto bez żadnego wcześniej
  zarejestrowanego faktora zapisuje się w tym samym miejscu, do którego
  trafiło. `mfa.totp.enroll_enabled`/`verify_enabled` są `true` na scl-dev
  **i na prod** (`docs/deferred-tasks.md` (a)), a `proxy.ts` to jeden plik
  wdrażany identycznie na oba środowiska — więc admin/DC na prodzie bez
  wcześniejszego zapisu TOTP przechodzi tę samą ścieżkę. **Wniosek: ten PR
  nie wymaga uprzedniego zapisania adminów do MFA przed wdrożeniem na
  prod** — pierwsze wejście na `/admin/...` samo poprowadzi przez zapis.

## Data / Status

2026-09-08 (DCS 1a.14) / przyjęta
