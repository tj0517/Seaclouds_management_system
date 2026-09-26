# DCS — tablica zadań

Widok dla ludzi. **Źródłem prawdy jest plik zadania** (`DCS-<id>.md`); przy rozbieżności rozstrzyga plik, a tablicę się poprawia.
Format zadania: [README.md](README.md) (pole `kind` — rodzaj pracy). Zadania zaimportowane z Notion 2026-09-22; od tej daty Notion nie jest źródłem zadań.

## Postęp kodu

**54 / 89 zadań kodowych zamkniętych (61%)** — stan na 2026-09-26.
Liczone tylko `kind: code`: zamknięte = zamknięte z Notion (42, bez 1a.21a — przygotowanie demo) + `done` w repo (12); otwarte = kodowe `todo`/`in_progress`/`review`/`blocked` (35). Nie wlicza się: prac poza kodem, odłożonych i porzuconych. Przy zmianie statusu zadania kodowego popraw tę linię.

## Kod — otwarte

| id | tytuł | status | trudność | zależności | pytania | due |
|---|---|---|---|---|---|---|
| [1a.27](DCS-1a.27.md) | Skan sekretów w CI (gitleaks) — PR z kluczem w kodzie jest zatrzymany | todo | S | — | — | — |
| [1b.22](DCS-1b.22.md) | Okno edycji dokumentu dla DC (bez pól tworzących numer SCL) | todo | M | — | — | — |
| [1b.25](DCS-1b.25.md) | MDR projektu jako zakładka na stronie projektu (obok listy dokumentów) | todo | M | — | — | — |
| [1b.26](DCS-1b.26.md) | Numer wykonawcy (contractor) na dokumencie — trzeci numer obok SCL i CPY | todo | M | — | — | — |
| [1b.27](DCS-1b.27.md) | Pola do wpisania odróżnione od pól automatycznych (tło i ramka) | todo | S | — | — | — |
| [2.01](DCS-2.01.md) | Schemat approval_tasks i comments | todo | L | — | — | 2026-10-02 |
| [2.02](DCS-2.02.md) | Silnik obiegu: tryb równoległy (IDC) | todo | L | — | — | 2026-10-16 |
| [2.03](DCS-2.03.md) | Silnik obiegu: tryb szeregowy (IFR i wyżej) | todo | L | — | — | 2026-10-23 |
| [2.04](DCS-2.04.md) | Distribute for IDC: wybór i zmiana recenzentów | todo | L | — | — | 2026-10-23 |
| [2.05](DCS-2.05.md) | Kody akceptacji 1–4 i końcowy kod dokumentu | todo | L | — | — | 2026-10-23 |
| [2.06](DCS-2.06.md) | Obsługa odrzucenia dokumentu | todo | M | — | — | 2026-10-23 |
| [2.07](DCS-2.07.md) | Zamknięcie obiegu przez Document Controllera | todo | L | — | — | 2026-10-30 |
| [2.08](DCS-2.08.md) | Blokada rozdziału obowiązków (Originator ≠ Checker, ale = Approver dozwolone) | todo | M | — | — | 2026-10-30 |
| [2.09](DCS-2.09.md) | Komentarze do rewizji jako adnotacje na PDF: model danych, Review ID | todo | L | 2.01, 2.20 | — | 2026-10-30 |
| [2.10](DCS-2.10.md) | Generowanie Comment Sheet w formacie SCMS-SCL-LA-0001 | todo | M | 2.09 | O-17 | 2026-11-06 |
| [2.11](DCS-2.11.md) | Odpowiedzi Originatora na komentarze | todo | M | 2.09 | — | 2026-11-06 |
| [2.12](DCS-2.12.md) | Daty Planned — wyliczenie jednorazowe przy tworzeniu MDR | todo | L | P.02 | — | 2026-10-30 |
| [2.13](DCS-2.13.md) | Edycja dat Forecast przez Originatora | todo | M | — | — | 2026-10-30 |
| [2.14](DCS-2.14.md) | Zmiana terminu etapu — przeniesienie do Forecast | todo | M | — | — | 2026-11-06 |
| [2.15](DCS-2.15.md) | My Page: kolejka zadań użytkownika | todo | L | — | — | 2026-11-06 |
| [2.16](DCS-2.16.md) | My Page: sekcja Ready for dispatch dla Document Controllera | todo | M | — | — | 2026-11-06 |
| [2.20](DCS-2.20.md) | Podgląd PDF w profilu dokumentu (PDF.js) | todo | M | — | — | — |
| [2.21](DCS-2.21.md) | Adnotacje na PDF w podglądzie: pinezka, obszar, tekst, lista komentarzy | todo | XL | 2.20, 2.09 | — | — |
| [3.02](DCS-3.02.md) | Transmittale: model danych i numeracja | todo | M | — | — | 2026-11-13 |
| [3.03](DCS-3.03.md) | Tworzenie transmittalu i paczki do klienta | todo | M | — | — | 2026-11-13 |
| [3.04](DCS-3.04.md) | Rejestr wysyłek i potwierdzenia | todo | S | — | — | 2026-11-13 |
| [3.05](DCS-3.05.md) | Eksport MDR w formacie klienta (CPY pierwsza kolumna) | todo | L | — | — | 2026-11-20 |
| [3.06](DCS-3.06.md) | Powiadomienia natychmiastowe | todo | M | — | — | 2026-11-13 |
| [3.07](DCS-3.07.md) | Podsumowanie tygodniowe (poniedziałek rano) | todo | M | — | — | 2026-11-20 |
| [3.08](DCS-3.08.md) | Eskalacja opóźnień powyżej 14 dni | todo | S | — | — | 2026-11-20 |
| [5.01](DCS-5.01.md) | Dashboard postępu dokumentacji | todo | S | — | — | 2026-11-20 |
| [5.02](DCS-5.02.md) | Raport opóźnień wg dyscypliny i osoby | todo | S | — | — | 2026-11-27 |
| [5.03](DCS-5.03.md) | Raport budżetu godzinowego i eksport CTR do TES | todo | M | — | — | 2026-11-20 |
| [5.04](DCS-5.04.md) | Statystyka kodów akceptacji | todo | S | — | — | 2026-11-27 |
| [5.05](DCS-5.05.md) | Operacje zbiorcze i zastępstwa | todo | S | — | — | 2026-11-27 |

## Poza kodem — klient, operacje, odbiory

`client` — czeka na decyzję lub materiał od Sea Clouds · `ops` — praca poza repo (backupy, RODO, instrukcje, szkolenia, testy z użytkownikami) · `milestone` — odbiór etapu.

| id | tytuł | rodzaj | status | trudność | zależności | pytania | due |
|---|---|---|---|---|---|---|---|
| [1b.16](DCS-1b.16.md) | Odbiór Fazy 1: testy RLS dcs.* w CI, migracje na czystej bazie, backupy, kod w repo Sea Clouds, rev. 2 procedury KQ-0001 po stronie klienta | milestone | todo | S | — | O-04 | 2026-09-30 |
| [2.17](DCS-2.17.md) | Testy obiegu na projekcie SC2602 | ops | todo | L | — | — | 2026-11-06 |
| [2.18](DCS-2.18.md) | Odbiór Fazy 2 (kamień milowy) | milestone | todo | L | 5.06 | — | 2026-11-06 |
| [2.19](DCS-2.19.md) | Rozstrzygnąć punkt otwarty O-08: zasady zastępstw | client | todo | M | — | — | 2026-10-30 |
| [3.01](DCS-3.01.md) | Ustalić format i szablon transmittalu (O-07) | client | todo | M | — | — | 2026-10-30 |
| [3.09](DCS-3.09.md) | Odbiór Fazy 3 (kamień milowy) | milestone | todo | L | — | — | 2026-11-20 |
| [5.06](DCS-5.06.md) | Kopie zapasowe, retencja i TEST ODTWORZENIA | ops | todo | L | — | — | 2026-11-20 |
| [5.07](DCS-5.07.md) | Przegląd RODO i minimalizacji danych | ops | todo | M | — | — | 2026-11-27 |
| [5.08](DCS-5.08.md) | Instrukcja użytkownika DCS | ops | todo | M | — | — | 2026-11-27 |
| [5.09](DCS-5.09.md) | Szkolenie zespołu | ops | todo | L | — | — | 2026-11-27 |
| [5.10](DCS-5.10.md) | Odbiór końcowy — 30.11.2026 (kamień milowy końcowy) | milestone | todo | L | — | — | 2026-11-30 |
| [5.11](DCS-5.11.md) | Rozstrzygnąć punkt otwarty O-04: retencja audit logu i kopii zapasowych | client | todo | M | — | — | 2026-11-13 |
| [P.01](DCS-P.01.md) | Aktualizacja procedury SCMS-SCL-KQ-0001 do rev. 2 | client | todo | M | — | — | 2026-11-20 |
| [P.02](DCS-P.02.md) | Wydanie briefu SCMS-SCL-SA-0001-PL rev. B (usunięcie sprzeczności) | client | todo | M | — | — | 2026-11-20 |

## Odłożone — import SMDR z klientem

Odłożone przez tj 2026-09-23; terminy zdjęte (poprzednie w notatkach zadań). Nie wliczają się do postępu kodu. Wznowienie: 1a.19 / 1b.12 → 1b.13 → 1b.14 → 1b.15.

| id | tytuł | rodzaj | status | trudność | zależności | pytania | due |
|---|---|---|---|---|---|---|---|
| [1a.19](DCS-1a.19.md) | Import 9 brakujących projektów z arkusza Projects (klient, cykl, role z Orig/Ch'd/App'd) | code | blocked | M | — | — | — |
| [1b.12](DCS-1b.12.md) | Analiza pliku SCL_SMDR_v4.xlsx: rozbieżności, puste daty, numery spoza formatu, mapowanie kolorów | code | blocked | M | — | — | — |
| [1b.13](DCS-1b.13.md) | Skrypt importu SMDR → documents/revisions (146 dok.), generator ustawiony na kolejny wolny numer, raport rozbieżności | code | blocked | L | 1a.18, 1a.19, 1b.02, 1b.04, 1b.12 | O-05 | — |
| [1b.14](DCS-1b.14.md) | Przejście raportu rozbieżności z DC pozycja po pozycji + poprawki importu | client | blocked | M | 1b.13 | — | — |
| [1b.15](DCS-1b.15.md) | Import na prod + pisemne potwierdzenie DC, że rejestr = plik; Excel do archiwum read-only | ops | blocked | M | 1b.14 | — | — |

## Porzucone

| id | tytuł | rodzaj | powód |
|---|---|---|---|
| [0.1](DCS-0.1.md) | Zamknąć warunki wejścia Fazy 1 (punkty otwarte O-01/03/04/05/06, słowniki od DC, zamrożony SMDR, dostępy) | client | rozbite: warunki wejścia importu (zamrożony SMDR, odpowiedź na O-05) przeniesione do DCS-1b.13; O-04 → DCS-5.11; O-03 rozstrzygnięte; O-01/O-06 żyją w docs/04-open-questions.md; zależność DCS-1b.14 przepięta na DCS-1b.13. |
| [1a.20](DCS-1a.20.md) | Potwierdzić backupy Supabase zgodnie z O-04 | ops | duplikat DCS-5.06 (kopie zapasowe, retencja, test odtworzenia) i punktu listy odbioru DCS-1b.16; retencję rozstrzyga DCS-5.11 (O-04). |
| [1a.21](DCS-1a.21.md) | Demo / bramka 1a→1b: login 2FA, role w SC2601, nowy projekt w kreatorze, edycja słownika, audit log | milestone | scalone z odbiorem Fazy 1 (DCS-1b.16): jedno demo 1a+1b wg docs/demo/1a21-demo-script.md przed mailem odbioru; bramka 1a→1b była w praktyce ominięta (Faza 1b zbudowana). |
| [1b.17](DCS-1b.17.md) | Foldery rewizji w storage (projekt / dokument / rewizja, tworzone automatycznie) | code | pokryte przez DCS-1b.09: obiekty w buckecie dcs-documents mają klucz {project_code}/{scl_doc_number}/{scl_revision}/{file_name} (apps/dcs/lib/files.ts, revisionFolder/objectPath), original_name i wiele plików (NN) w rewizji działają; w Supabase Storage folder powstaje z pierwszym plikiem. |

## Zamknięte w repo

| id | tytuł | rodzaj | trudność |
|---|---|---|---|
| [1a.25c](DCS-1a.25c.md) | Timesheet /mfa: test regresji w repo (Playwright, trzy tryby) | code | M |
| [1b.04b](DCS-1b.04b.md) | New Document: stan „w toku”, projekt z kontekstu, informacja o nawigacji w toku | code | S |
| [1b.09b](DCS-1b.09b.md) | Wyścig hydratacji po logowaniu/MFA (React #418 na liście akcji profilu dokumentu) | code | L |
| [1b.11](DCS-1b.11.md) | Ręczna zmiana statusu dokumentu przez DC + Void dokumentu (Faza 1: bez silnika obiegu) | code | S |
| [1b.08b](DCS-1b.08b.md) | Stan „w toku” w oknie New Revision (przycisk zapisu bez informacji zwrotnej) | code | S |
| [1b.20](DCS-1b.20.md) | Tabela dokumentów projektu: pełne nazwy typu, dyscypliny i obszaru | code | S |
| [1b.24](DCS-1b.24.md) | Włączenie DCS dla istniejącego projektu Timesheeta (kreator „Enable DCS” zamiast zakładania projektu) | code | L |
| [1b.24b](DCS-1b.24b.md) | Enable DCS: kreator i funkcja uwzględniają zespół przypisany przed włączeniem DCS | code | M |
| [1b.19](DCS-1b.19.md) | DC edytuje ustawienia DCS projektu (cykle, budżet, numeracja CPY, status MDR) | code | M |
| [1b.18](DCS-1b.18.md) | Macierz osób i ról na stronie projektu (przydzielanie ról jednym kliknięciem) | code | M |
| [1b.21](DCS-1b.21.md) | Słowniki: wyjaśnienie „Sort order” i „Est. budget (h)” w tabeli i formularzu | code | S |
| [1b.23](DCS-1b.23.md) | Profil dokumentu: bez technicznego Document ID, pliki w „Current revision” tylko z nazwą | code | S |

## Zamknięte (historia w Notion)

Zamknięte przed importem; pełna treść i decyzje zostały w Notion (link). Decyzje wpływające na otwarte zadania są przepisane do ich „Notatek z realizacji”.

| id | tytuł | trudność | due | Notion |
|---|---|---|---|---|
| 1a.00 | Fundament repo i pipeline (baseline bazy, monorepo, packages/db, CI/CD, bramka prod) | L | 2026-08-30 | [link](https://app.notion.com/p/3ccc2fbc059581e09303d376ff0bc553) |
| 1a.00b | Szkielet apps/dcs + pliki kontekstowe docs/ (ERD, konwencje, ADR-y, szablon taska) | M | 2026-08-31 | [link](https://app.notion.com/p/3ccc2fbc0595815296ddf5b7928e8bb4) |
| 1a.01 | Wyjaśnić project_manager vs project_lead i zsynchronizować migracje z prod (supabase db diff) | M | 2026-08-26 | [link](https://app.notion.com/p/3c7c2fbc059581b9b8fde5cd34c7024f) |
| 1a.02 | Sprzątnąć Supabase advisor (search_path, REVOKE anon na SECURITY DEFINER, leaked password protection) | S | 2026-08-31 | [link](https://app.notion.com/p/3c7c2fbc059581828643ceefb3ca63c1) |
| 1a.03 | Uporządkować projects: kod dla „IT admin”, decyzja SCMS_TEST/SCC005, constraint na format project_code | S | 2026-08-31 | [link](https://app.notion.com/p/3c7c2fbc059581bc8e4ae094e67ebde4) |
| 1a.04 | Tabela clients + FK projects.client_id | S | 2026-09-01 | [link](https://app.notion.com/p/3c7c2fbc059581df9de8fced7cdd7f2b) |
| 1a.05 | Rozszerzyć projects: process_type, cpy_numbering, cykl 7/10/7, budget_hours, year, status | M | 2026-09-01 | [link](https://app.notion.com/p/3c7c2fbc0595811db182eb0560a150d8) |
| 1a.06 | Tabela project_roles (ORIG/REV/CHK/APP/DC/VIEW) obok project_assignments | M | 2026-09-02 | [link](https://app.notion.com/p/3c7c2fbc0595814da07cd410b8e213cc) |
| 1a.07 | Tabela dictionaries (dict_type, code, label, meta jsonb, is_active) | S | 2026-09-02 | [link](https://app.notion.com/p/3c7c2fbc0595817ea5f0f72f04359b69) |
| 1a.08 | audit_log + generyczny trigger (projects, project_roles, profiles, dictionaries) | M | 2026-09-03 | [link](https://app.notion.com/p/3c7c2fbc059581b4b81ee1149fe4924c) |
| 1a.09 | Funkcje i polityki RLS: has_project_role(), is_doc_controller(); polityki na clients/project_roles/dictionaries | L | 2026-09-03 | [link](https://app.notion.com/p/3c7c2fbc059581318f13e586b4879cab) |
| 1a.09b | Polityka zapisu dla DC na dcs.dictionaries (domknięcie luki z 1a.09) | S | 2026-09-06 | [link](https://app.notion.com/p/3d1c2fbc05958148a0bad2dbb1df18eb) |
| 1a.10 | Testy RLS w SQL w CI (użytkownik spoza projektu, employee vs słownik, DC vs cykl) | M | 2026-09-04 | [link](https://app.notion.com/p/3c7c2fbc059581839a0cc5d8eb7edcb3) |
| 1a.11 | 2FA TOTP dla admin i DC + wymuszenie aal2 w proxy.ts i politykach RLS | L | 2026-09-04 | [link](https://app.notion.com/p/3c7c2fbc059581a5af6acf7cd51d4577) |
| 1a.12 | auth-helpers: role projektowe + hook do warunkowego renderowania akcji | S | 2026-09-04 | [link](https://app.notion.com/p/3c7c2fbc0595818080b4e3683f641d8b) |
| 1a.13 | Przełącznik modułów TES/DCS w layoucie, segment tras /dcs | S | 2026-09-07 | [link](https://app.notion.com/p/3c7c2fbc0595815f89aed8af22024d4a) |
| 1a.14 | Admin: macierz użytkownik × projekt × rola (rozszerzenie app/admin/users) | M | 2026-09-07 | [link](https://app.notion.com/p/3c7c2fbc059581088699d078951c8c51) |
| 1a.14b | Lista /dcs filtrowana po dcs.project_roles + nazwiska współczłonków (profiles RLS) | M | 2026-09-09 | [link](https://app.notion.com/p/3d5c2fbc059581df9398d47b34c5448e) |
| 1a.15 | Ekran słowników (generyczny, zakładki per typ, flaga active, DC/admin) | M | 2026-09-07 | [link](https://app.notion.com/p/3c7c2fbc059581d8b9dad450851af9b6) |
| 1a.15b | updateDictionaryEntry diff-only + trigger niezmienności code | M | 2026-09-11 | [link](https://app.notion.com/p/3d7c2fbc059581209d1bc0272792e3dd) |
| 1a.16 | Ekran klientów (lista + formularz) | S | 2026-09-08 | [link](https://app.notion.com/p/3c7c2fbc05958121b880ef91191d5c27) |
| 1a.17 | Kreator Create Project MDR (identyfikacja, klient, cykl, zespół i role, kody CTR, budżet) + EditProjectDialog | L | 2026-09-08 | [link](https://app.notion.com/p/3c7c2fbc059581a882cae68476a836f4) |
| 1a.17b | Audit log dla dcs.mdr_settings (gałąź w audit_trigger dla PK project_id) | M | — | [link](https://app.notion.com/p/3d8c2fbc059581e1a54ef8e814752b15) |
| 1a.17c | Niezmienność projects.project_code (trigger DB) + read-only w dialogu TES | S | — | [link](https://app.notion.com/p/3d8c2fbc059581b387f4e37bd63940b2) |
| 1a.18 | Seed słowników z załączników A i B briefu (migracja danych) | S | 2026-09-08 | [link](https://app.notion.com/p/3c7c2fbc059581d2850ac0ab12b384d6) |
| 1a.21a | Przygotowanie demo 1a na scl-dev (SC2601, linki /admin w sidebarze, zdjęcie RLS probe, scenariusz) | S | — | [link](https://app.notion.com/p/3ddc2fbc059581dc8830ee2c8eb6589f) |
| 1a.22 | Uprawnienia na poziomie modułu (TES / DCS / BMS) per użytkownik | L | 2026-09-04 | [link](https://app.notion.com/p/3ccc2fbc0595815699a7e934b5cf13ea) |
| 1a.23 | Portal SCL: strona startowa z kafelkami modułów i wspólne logowanie (SSO) | M | 2026-09-04 | [link](https://app.notion.com/p/3ccc2fbc059581b29cddef398b8be3d1) |
| 1a.24 | Poprawa UI apps/dcs: stany ładowania przy nawigacji i akcjach + dopracowanie wyglądu (sidebar, lista projektów, ekrany admina) | M | — | [link](https://app.notion.com/p/3dec2fbc059581dca00dfbe4a6baa173) |
| 1a.25 | Naprawa /mfa: po poprawnej weryfikacji TOTP nawigacja klienta nie przechodzi dalej („Verifying…”) | M | — | [link](https://app.notion.com/p/3dec2fbc059581db8964eef9503c514c) |
| 1a.25b | Timesheet /mfa: port poprawki zawieszenia „Verifying…” z DCS (pełne przeładowanie po verify) | S | 2026-09-22 | [link](https://app.notion.com/p/3e1c2fbc059581608ab1c753e0986602) |
| 1a.26 | Timesheet /mfa: walidacja parametru next (otwarte przekierowanie, javascript:) — deferred (nn) | M | — | [link](https://app.notion.com/p/3dec2fbc059581579b04effc8d0b8fe2) |
| 1b.01 | Schemat dcs: documents, revisions, files, mdr_settings + RLS i audit trigger | M | 2026-09-10 | [link](https://app.notion.com/p/3c7c2fbc059581379afdd6719d7e54d2) |
| 1b.02 | Generator numeracji SCL (funkcja PG, atomowy, SEQ per PROJEKT+TYPE, Void bez reużycia, blokada ręcznego wpisu) | L | 2026-09-14 | [link](https://app.notion.com/p/3c7c2fbc0595815a838dfaea32ece362) |
| 1b.03 | Numer CPY (ręczny, opcjonalny, tylko DC, unikalny w projekcie, zmiana w audit logu) | S | 2026-09-14 | [link](https://app.notion.com/p/3c7c2fbc059581509f56db6f4e49f06d) |
| 1b.04 | Formularz tworzenia dokumentu (typ, dyscyplina, obszar, język, CTR, budżet z typu, zespół) | M | 2026-09-15 | [link](https://app.notion.com/p/3c7c2fbc059581c4aa88cab1c9645c2d) |
| 1b.05 | Rejestr MDR: tabela z grupami kolumn jak w arkuszu (zał. C), filtry, wspólne szukanie SCL/CPY/tytuł, kolory statusów | L | 2026-09-17 | [link](https://app.notion.com/p/3c7c2fbc059581f9a7a6e3cfef29a2ef) |
| 1b.06 | Eksport MDR do Excela z aktywnymi filtrami + zapisywalne widoki użytkownika | M | 2026-09-18 | [link](https://app.notion.com/p/3c7c2fbc059581228acaf4408ace8c9e) |
| 1b.07 | Profil dokumentu: zakładka Information + Additional attributes + panel bieżącej rewizji | M | 2026-09-18 | [link](https://app.notion.com/p/3c7c2fbc0595810a8957cda16d36beb5) |
| 1b.07b | Zapis numeru CPY wisi na „Saving…" na buildzie produkcyjnym (profil dokumentu) | L | 2026-09-22 | [link](https://app.notion.com/p/3e1c2fbc05958136a8a1e150a53f319a) |
| 1b.08 | Okno New Revision (etap, rewizja SCL proponowana przez system, rewizja CPY, data, powód) + zakładka Revisions | M | 2026-09-21 | [link](https://app.notion.com/p/3c7c2fbc05958166a0e5f504eb763651) |
| 1b.09 | Pliki: Supabase Storage, signed URL, automatyczna nazwa pliku (§6.6), file_kind, lista i pobieranie | L | 2026-09-22 | [link](https://app.notion.com/p/3c7c2fbc059581639e4ec2a727a4b257) |
| 1b.10 | Blokada modyfikacji rewizji finalnych IFC/IFI/IFB (trigger w bazie, nie frontend) | M | 2026-09-22 | [link](https://app.notion.com/p/3c7c2fbc059581ae8d69d09d213e7e5e) |
