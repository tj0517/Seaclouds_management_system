# ADR-0008 — `project_roles` w schemacie `dcs`, nie w `public`

## Kontekst

ERD z Fazy 0 (brief §3, [ADR-0006](0006-role-dcs-per-projekt.md)) umieszczał
tabelę ról projektowych w warstwie core obok `projects` i `profiles`, pod
roboczą nazwą `project_members`. Zadanie DCS 1a.06 tworzy tę tabelę
naprawdę i musi rozstrzygnąć dwie rzeczy: schemat (`public` = core TES czy
`dcs`) oraz nazwę.

Fakty w chwili decyzji (odczyt scl-dev 2026-09-03): w `public` żyją
wyłącznie tabele TES i wspólne (`profiles`, `projects`, `sub_projects`,
`clients`); jedyna tabela DCS, `dcs.mdr_settings` (1a.05), leży w schemacie
`dcs` z grantami tylko dla `authenticated`/`service_role`
([ADR-0003](0003-osobny-schemat-dcs.md)). Role ORIG/REV/CHK/APP/DC/VIEW są
pojęciami DCS — TES ich nie czyta, a `public.project_assignments` („kto
loguje godziny”) ma inną semantykę i zostaje nietknięte.

## Decyzja

- Tabela ról projektowych to **`dcs.project_roles`**, enum **`dcs.project_role`**
  (`orig|rev|chk|app|dc|view`, małe litery jak `user_role`
  i `project_process_type`). Nazwa `project_members` z ADR-0006 i ERD
  jest zastąpiona: wiersz to *rola* osoby w projekcie (jedna osoba może mieć
  kilka wierszy), nie *członkostwo*.
- Schemat **`dcs`**, wbrew ERD Fazy 0 — precedens `dcs.mdr_settings`: to, co
  czyta wyłącznie DCS, mieszka w `dcs`; `public` rozszerza się tylko o
  tożsamość wspólną dla modułów (jak `projects.process_type`, O-13).
- `project_roles` istnieje **obok** `project_assignments`, nie zamiast.
  Globalny `profiles.role = 'admin'` pozostaje ADM z briefu i nie jest
  duplikowany jako rola projektowa.
- Wartość `cpy` (kontakt klienta z ERD) nie wchodzi do enuma teraz — dojdzie
  w Fazie 3 razem z komunikacją z klientem.

## Konsekwencje

- Granty i default privileges schematu `dcs` (bez `anon`, bez `PUBLIC`)
  obejmują tabelę automatycznie; test `advisor_grants.test.sql` pilnuje
  bazy, a `rls_project_roles.test.sql` polityk.
- Polityki RLS pozostałych tabel `dcs.*` (1a.09: `has_project_role()`,
  `is_doc_controller()`) odwołują się do `dcs.project_roles`; funkcje te
  muszą być `security definer` z przypiętym `search_path`, bo polityka
  na samej `project_roles` odwołująca się do `project_roles` by rekurowała.
- **Skutek dla QMS**: jeśli przyszły moduł QMS będzie potrzebował ról
  projektowych, tabela wymaga **przeniesienia do core** (`public`) lub
  wydzielenia wspólnego schematu — a wraz z nią polityki i funkcje 1a.09.
  Przenoszenie odbywa się migracją (nowa tabela + kopia danych + zamiana
  FK), nie zmianą tej decyzji w miejscu. Do tego czasu QMS nie czyta `dcs.*`.
- Dokumentacja (`02-data-model.md`, O-12) używa nazwy `project_roles`;
  komentarze w wypchniętej migracji `20260902114744` („`project_members`”)
  zostają jako zastane — migracji się nie edytuje.

## Data / Status

2026-09-03 (DCS 1a.06) / przyjęta
