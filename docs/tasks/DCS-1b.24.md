---
id: DCS-1b.24
title: "Włączenie DCS dla istniejącego projektu Timesheeta (kreator „Enable DCS” zamiast zakładania projektu)"
status: in_progress
kind: code             # code | client | ops | milestone
difficulty: L
model: null
model_approved: null
effort: null
branch: feat/dcs-1b24-enable-dcs
due: null
depends_on: []
blocked_by_questions: []
touches_db: true
touches_prod: false
pr: null
---

# DCS-1b.24 — Włączenie DCS dla istniejącego projektu Timesheeta

## Cel
Na produkcji jest 8 projektów założonych w Timesheecie i żaden nie działa w DCS (odczyt prod 2026-09-25: 0 wierszy `dcs.mdr_settings`). Kreator „Create Project MDR” (1a.17) zawsze zakłada **nowy** projekt, więc istniejącego nie da się uruchomić w DCS — użytkownik widzi „DCS does not run this project”. Po zadaniu admin wybiera projekt z Timesheeta bez DCS i ustawia wyłącznie rzeczy DCS: numerację CPY, cykle przeglądu, budżet godzin i zespół z rolami. Dane wspólne (kod, nazwa, klient, typ procesu, rok) są tylko wyświetlane — w DCS nikt ich nie edytuje.

## Zakres
- [ ] Odczyt stanu bieżącego: `public.dcs_create_project_mdr` (migracja `20260911103639`) i `supabase/tests/dcs_create_project_mdr.test.sql`, `CreateProjectWizard`, akcja `createProjectMdr`, polityki INSERT na `dcs.mdr_settings` i `dcs.project_roles`, audyt `mdr_settings`
- [ ] Nowa funkcja w bazie, tylko dla admina (sprawdzenie uprawnień pierwszym poleceniem, jak w `dcs_create_project_mdr`): dla istniejącego wiersza `public.projects` wstawia `dcs.mdr_settings` i role w `dcs.project_roles` w jednej transakcji; odmawia dla projektu, który ma już DCS, i dla nieistniejącego; **nie zapisuje** `public.projects` ani `public.sub_projects`
- [ ] Numeracja CPY dozwolona tylko dla projektu z klientem (ta sama reguła co w `dcs_create_project_mdr`); w kreatorze przełącznik niedostępny z wyjaśnieniem, gdy projekt nie ma klienta
- [ ] Kreator `/admin/projects/new` → „Enable DCS”: wybór projektu bez DCS (kod, nazwa, klient, typ, rok tylko do odczytu), potem cykle, numeracja CPY, zespół (co najmniej jeden DC — reguła `hasDocController`), budżet; bez kroków identyfikacji, klienta i kodów CTR
- [ ] Droga „nowy projekt” znika z UI (wejście do kreatora i akcja `createProjectMdr`); funkcja `dcs_create_project_mdr` zostaje w bazie
- [ ] Komunikaty „DCS does not run this project…” wskazują admina i „Enable DCS”

## Gotowe, gdy
- admin włącza DCS dla projektu bez DCS; na tym projekcie znika komunikat i da się utworzyć dokument — **jak sprawdzić**: dowód przeglądarkowy na buildzie produkcyjnym lokalnie (skrypt `e2e:*` albo Playwright MCP), stan „w toku” do momentu, gdy odświeżone dane są w DOM (reguła z 1b.09, `docs/03-conventions.md`), plus SELECT lokalnie na `dcs.mdr_settings` i `dcs.project_roles`
- red proof: nie-admin (DC innego projektu, zwykły członek) wołający funkcję dostaje odmowę (42501) przed jakimkolwiek zapisem — **jak sprawdzić**: test pgTAP
- red proof: drugie włączenie tego samego projektu i nieistniejący projekt kończą się błędem — **jak sprawdzić**: test pgTAP
- red proof: numeracja CPY dla projektu bez klienta odrzucona przez bazę — **jak sprawdzić**: test pgTAP
- funkcja nie zmienia `public.projects` ani `public.sub_projects` — **jak sprawdzić**: test pgTAP (wiersz projektu i liczba kodów CTR przed i po) + `git diff origin/main -- supabase/migrations` bez `update public.projects` / `insert into public.sub_projects`
- włączenie zostawia ślad w `public.audit_log` (`mdr_settings`, `project_roles`) — **jak sprawdzić**: SELECT lokalnie, wynik w raporcie

## Poza zakresem
- edycja pól wspólnych (nazwa, klient, typ procesu, rok) — nigdzie w DCS (tj 2026-09-25); docelowo portal admina (ADR-0014); do tego czasu → O-20
- nowe kody CTR — `public.sub_projects` to dane Timesheeta (O-06)
- usunięcie funkcji `dcs_create_project_mdr` z bazy → osobne zadanie za bramką (wpis do deferred)
- edycja ustawień DCS po włączeniu → 1b.19
- włączenie DCS dla konkretnych projektów na produkcji — czynność admina po wdrożeniu, nie agenta

## Bramki STOP
- przed napisaniem migracji z nową funkcją albo zmianą polityk `dcs.mdr_settings` / `dcs.project_roles` — pokaż projekt funkcji i diff polityk względem baseline, czekaj na akceptację
- jakakolwiek zmiana istniejącej funkcji `dcs_create_project_mdr` albo jej migracji — nie w tym zadaniu
- merge do `main` = produkcja DCS i Timesheet (migracja trafia na prod przez `deploy-db.yml` za bramką)

## Kontekst
- `CLAUDE.md`, `docs/03-conventions.md`, `docs/02-data-model.md` (O-13: podział pól `projects` / `mdr_settings`)
- `supabase/migrations/20260911103639_dcs_create_project_mdr.sql`, `supabase/tests/dcs_create_project_mdr.test.sql` — wzorzec funkcji i testu
- `apps/dcs/components/CreateProjectWizard.tsx`, `apps/dcs/lib/project-mdr.ts`, `apps/dcs/app/data/actions/project-mdr.ts`
- `docs/adr/0014-portal-admin.md` — gdzie docelowo żyją dane wspólne

## Notatki z realizacji
- 2026-09-25 tj: ustalenie z klientem — DCS nie zakłada projektów, tylko włącza DCS dla projektów z Timesheeta; pola wspólne w DCS tylko do odczytu (także dla admina), docelowo zarządzane w portalu admina.
