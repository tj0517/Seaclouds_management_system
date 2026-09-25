---
id: DCS-1b.24b
title: "Enable DCS: kreator i funkcja uwzględniają zespół przypisany przed włączeniem DCS"
status: review
kind: code             # code | client | ops | milestone
difficulty: M
model: sonnet
model_approved: null
effort: medium
branch: fix/dcs-1b24b-existing-team
due: 2026-09-26
depends_on: [DCS-1b.24]
blocked_by_questions: []
touches_db: true
touches_prod: false
pr: 98
---

# DCS-1b.24b — Enable DCS przy istniejącym zespole projektu

## Cel
Role w `dcs.project_roles` wiszą na projekcie, nie na włączonym DCS, więc panel zespołu pozwala obsadzić projekt, zanim DCS zostanie włączony. Na prod SC2602 ma 12 ról (w tym DC) z 24.09 i 0 wierszy `dcs.mdr_settings` (odczyt 2026-09-25). Kreator „Enable DCS” (1b.24) nie wczytuje tego zespołu: pokazuje pusty krok, wymaga dodania DC od nowa, a `dcs_enable_project_mdr` wywraca się na `UNIQUE (project_id, user_id, role)` i cofa całe włączenie. Po zadaniu admin włącza DCS także dla projektu z istniejącym zespołem: widzi obecne role, istniejący DC spełnia wymóg „co najmniej jeden DC”, a funkcja dopisuje wyłącznie nowe pary osoba+rola.

## Zakres
- [ ] Odczyt stanu bieżącego: `public.dcs_enable_project_mdr` (migracja `20260925111841`) i jej test, `EnableDcsWizard`, `getProjectsWithoutMdr`, `/admin/projects/new/page.tsx`, panel zespołu (`apps/dcs/lib/project-roles.ts`)
- [ ] Nowa migracja (bez edycji `20260925111841`): funkcja pomija pary (osoba, rola) już przypisane w projekcie zamiast zgłaszać błąd; reszta zachowania bez zmian (admin-only jako pierwsze polecenie, odmowa dla projektu z DCS i nieistniejącego, CPY tylko z klientem, zero zapisów w `public.projects` / `public.sub_projects`)
- [ ] Kreator, krok „Team and roles”: pokazuje role już przypisane w wybranym projekcie (tylko do odczytu, z dopiskiem, że zmienia się je w panelu zespołu) i pozwala dodać nowe; wymóg „co najmniej jeden DC” liczy role istniejące + dodane
- [ ] Kreator nie wysyła do funkcji par, które już istnieją

## Gotowe, gdy
- DCS włącza się dla projektu z istniejącym zespołem (w tym DC), bez dodawania nikogo w kreatorze — **jak sprawdzić**: test pgTAP (projekt z rolami przed włączeniem → `mdr_settings` jest, liczba ról bez zmian) + dowód przeglądarkowy na lokalnym buildzie produkcyjnym (Playwright MCP)
- red proof: włączenie z listą ról zawierającą parę już przypisaną nie kończy się błędem i nie tworzy duplikatu — **jak sprawdzić**: test pgTAP (przed poprawką ten sam test jest czerwony: 23505)
- nowe role dodane w kreatorze są zapisane i widoczne w `audit_log`; istniejące nie dostają nowego wpisu — **jak sprawdzić**: test pgTAP
- wszystkie dotychczasowe asercje `dcs_enable_project_mdr.test.sql` nadal zielone (odmowa nie-admina, podwójne włączenie, nieistniejący projekt, CPY bez klienta, brak zmian w danych Timesheeta) — **jak sprawdzić**: `supabase test db`

## Poza zakresem
- usuwanie lub zmiana istniejących ról z poziomu kreatora — panel zespołu
- naprawa `e2e/pending-action.mjs` (sekcja „wizard”) i martwego kodu → deferred (kkk)
- edycja ustawień DCS po włączeniu → DCS-1b.19
- włączenie DCS dla SC2602 na produkcji — czynność admina po wdrożeniu

## Bramki STOP
- przed napisaniem migracji: pokaż zmienione ciało funkcji jako diff względem `20260925111841` i czekaj na akceptację
- merge do `main` = produkcja DCS i Timesheet

## Kontekst
- `CLAUDE.md`, `docs/03-conventions.md`, `docs/02-data-model.md`
- `supabase/migrations/20260925111841_dcs_enable_project_mdr.sql`, `supabase/tests/dcs_enable_project_mdr.test.sql`
- `apps/dcs/components/EnableDcsWizard.tsx`, `apps/dcs/lib/project-mdr.ts`, `apps/dcs/app/(app)/admin/projects/new/page.tsx`, `apps/dcs/lib/project-roles.ts`

## Notatki z realizacji
- 2026-09-25 tj (STOP gate, przegląd zmienionego ciała `dcs_enable_project_mdr`): zatwierdzone jako nowa
  migracja `20260925131237_dcs_enable_project_mdr_skip_existing_roles.sql` (`ON CONFLICT (project_id, user_id,
  role) DO NOTHING`), z warunkami: (1) "istniejące role nie dostają nowego wpisu w audit_log" musi być
  udowodnione asercją pgTAP (licznik audit_log dla pary istniejącej niezmieniony, dla nowej pary +1), nie tylko
  rozumowaniem — `audit_project_roles` to AFTER INSERT na prod, sprawdzone odczytem; (2) dotychczasowe asercje
  "bad role payload" mają zostać zielone — ON CONFLICT celuje wyłącznie w (project_id, user_id, role), więc
  nieznany user lub rola nadal muszą zgłaszać błąd; (3) REVOKE/GRANT i komentarz funkcji odtworzone w nowej
  migracji. Wszystkie trzy warunki spełnione — `supabase test db`: 43 asercje w pliku testowym, pełny zestaw
  zielony (1286 testów).

## Notatki z realizacji
- 2026-09-25 tj: błąd znaleziony przy pierwszym włączeniu DCS na prod (SC2602, 23505 na `project_roles_project_id_user_id_role_key`; transakcja cofnięta, dane nietknięte). Wybrana poprawka zamiast obejścia.
