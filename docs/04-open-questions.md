# Punkty otwarte

O-01…O-10 pochodzą z briefu (sekcja 16); O-11+ dopisane podczas prac.
Agent: jeśli task zależy od punktu „otwarty” — nie zgaduj rozstrzygnięcia;
zaimplementuj tak, żeby decyzja była tania do wprowadzenia, i zgłoś w raporcie.

| Nr | Zagadnienie | Status | Kto decyduje | Co blokuje |
|---|---|---|---|---|
| O-01 | Nazwa portalu nadrzędnego (propozycja: SCL Portal) | otwarty | Sea Clouds (MD) | Tylko naming w UI/repo; prace nie stoją |
| O-02 | Zakres integracji z SCL-TES — wspólny core w Fazie 1a | **rozstrzygnięty** — TES reużyty jako core, [ADR-0001](adr/0001-reuzycie-tes-jako-core.md) | — | — |
| O-03 | Hosting frontendu | **rozstrzygnięty** — Timesheet działa na Vercelu (Root Directory `apps/timesheet`); przyjęcie tego samego dla `apps/dcs` do formalnego potwierdzenia | Wykonawca (rekomendacja: Vercel) | Konfigurację deployu `apps/dcs` (część 2) |
| O-04 | Okres retencji audit logu i kopii zapasowych (RODO) | otwarty | Sea Clouds (MD) | Definicję polityki retencji w `public.audit_log` (tabela istnieje od 2026-09-03, migracja `20260903173128`, DCS 1a.08; kasować może wyłącznie `postgres` — role API nie mają DELETE/TRUNCATE) |
| O-05 | Mapowanie kolorów z kolumny E arkusza SMDR na `workflow_status` | otwarty | Sea Clouds (DC) | Import M14 (test akceptacyjny Fazy 1b) i kolory statusów w widoku MDR — patrz [02-data-model.md](02-data-model.md) |
| O-06 | Kody CTR wspólne firmowo czy per projekt | otwarty | Sea Clouds (MD) | Kształt FK `dcs.documents.ctr_code` i sekcję CTR kreatora Create Project MDR — patrz [02-data-model.md](02-data-model.md) |
| O-07 | Format i szablon transmittalu (wzory klientów?) | otwarty | Sea Clouds (DC) | Moduł M11 (Faza 3); model `dcs.transmittals` można założyć wcześniej |
| O-08 | Zasady zastępstw przy nieobecności Checkera/Approvera | otwarty | Sea Clouds (MD) | Reguły przepisywania zadań w M7 (Faza 2); model `approval_tasks` już to przewiduje (przepisanie przez DC + audit log) |
| O-09 | Automatyczne PDF rendition przy wgraniu pliku źródłowego | otwarty | Sea Clouds (DC) | Zakres M6 (Faza 1b); pole `file_kind = rendition` istnieje niezależnie od decyzji |
| O-10 | Numer i typ dokumentu dla briefu (propozycja SCMS-SCL-SA-0001-PL) | otwarty | Sea Clouds (DC) | Nic w kodzie |

## Dopisane

| Nr | Zagadnienie | Status | Kto decyduje | Co blokuje |
|---|---|---|---|---|
| O-11 | Kody projektów na prod niezgodne z formatem SCYYNN/SCMS: `""` (IT admin), `SCC005`, `SCMS_TEST` (odczyt prod 2026-08-31). Poprawić dane, dopuścić wyjątki, czy wyłączyć te projekty z DCS? | **rozstrzygnięty częściowo** (2026-09-01, migracja `20260901082600_enforce_project_code_format`) — `IT admin` dostał kod `SCMS-IT`; `project_code` jest teraz `NOT NULL` + `CHECK (^SC\d{4}$ OR ^SCMS OR = 'SCC005')`; `SCMS_TEST` pasuje do `^SCMS`. **Zostaje:** `SCC005` (ISO Certyfikacja) jako wyjątek **imienny**, nigdy wzorcowy. Warunek wygaśnięcia: gdy projekt zostanie przenumerowany do formatu SCYYNN albo zarchiwizowany — wtedy usunąć człon `= 'SCC005'` (`docs/deferred-tasks.md`). Walidacja generatora numeracji (M3) osobno. | Sea Clouds (DC/MD) — tylko los `SCC005` | — |
| O-12 | Mapowanie ról projektowych DCS (ORIG/REV/CHK/APP/DC/VIEW) na istniejący globalny enum `user_role` (admin/employee/project_lead) | **rozstrzygnięty** — `user_role` zostaje globalny i należy do TES (bez DC/ADM); role DCS wyłącznie per projekt w `dcs.project_roles` (roboczo `project_members`; nazwa i schemat `dcs` — [ADR-0008](adr/0008-project-roles-w-schemacie-dcs.md), migracja `20260903134914`, DCS 1a.06); `project_lead` niemapowany; administrator DCS = `profiles.role = 'admin'`, [ADR-0006](adr/0006-role-dcs-per-projekt.md) | — | — |
| O-13 | Podział pól konfiguracji MDR między `public.projects` (wspólne: `process_type`, `client_id`, `year`, `status`) a `dcs.mdr_settings` (specyficzne dla DCS) — brief zakłada `core.projects`, ale rozszerzanie tabeli produkcyjnej TES wymaga decyzji, które pola są naprawdę wspólne | **rozstrzygnięty** (2026-09-02, DCS 1a.05, migracje `20260902114742-44`) — `projects` ← `process_type`, `year` (tożsamość wspólna; `client_id` już od 1a.04); `dcs.mdr_settings` (1:1, PK = project_id) ← `cpy_numbering`, trzy cykle, `budget_hours`, `status`. `status` MDR świadomie NIE w `projects`: TES ma `is_active` (logowanie godzin), status MDR = dokumentacja otwarta/zamknięta — uzasadnienie w [02-data-model.md](02-data-model.md) | — | — |
| O-14 | 2FA dla ról DC i Administrator — wymóg bezpieczeństwa briefu §3.5; realizacja przez Supabase Auth MFA, konfiguracja przez `config.toml`/migracje, nie dashboard. Zadanie **Fazy 1a, termin 2026-09-15** | otwarty (projektowanie) | wykonawca + MD | Politykę RLS na operacjach DC i wymuszenie aal2 w middleware |
