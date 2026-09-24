---
id: DCS-1b.08b
title: "Stan „w toku\" w oknie New Revision (przycisk zapisu bez informacji zwrotnej)"
status: done
kind: code             # code | client | ops | milestone
difficulty: S
model: Sonnet
model_approved: null
effort: null
branch: feat/dcs-1b08b-new-revision-pending
due: 2026-09-29
depends_on: []
blocked_by_questions: []
touches_db: false
touches_prod: false
pr: 92
notion: https://app.notion.com/p/3e2c2fbc059581f084eee5e9b40f9310
---

# DCS-1b.08b — Stan „w toku" w oknie New Revision (przycisk zapisu bez informacji zwrotnej)

## Cel
Przycisk zapisu w oknie New Revision ma pokazywać, że akcja trwa, i chronić przed podwójnym wysłaniem — spójnie z tym, co 1b.09 zrobiło dla Add File.

## Zakres
- [x] Odczyt stanu bieżącego (dodane przy imporcie)
- [x] Przycisk zapisu w New Revision: stan „w toku” (disabled + etykieta/spinner) od kliknięcia do zatwierdzenia drzewa, spójny z tym, co 1b.09 robi dla Add File
- [x] Ochrona przed podwójnym wysłaniem
- [x] Przejrzeć pozostałe dialogi z zapisem na profilu dokumentu — ten sam wzorzec, bez rozszerzania zakresu na inne ekrany

## Gotowe, gdy
- Na buildzie produkcyjnym: stan „w toku” widoczny od kliknięcia do końca zapisu — **jak sprawdzić**: dowód przeglądarkowy na buildzie produkcyjnym
- Podwójne kliknięcie nie tworzy dwóch rewizji — **jak sprawdzić**: dowód w bazie
- `e2e:revision` zielone — **jak sprawdzić**: przebieg `e2e:revision`

## Poza zakresem
Inne ekrany niż profil dokumentu („bez rozszerzania zakresu na inne ekrany”).

## Bramki STOP
—

## Kontekst
Zgłoszone przez tj 21.09 przy teście 1b.09 na Preview: po kliknięciu zapisu w oknie New Revision przycisk nie pokazuje, że akcja trwa — użytkownik nie wie, czy kliknięcie zadziałało. Przy 3–4 s na zapis (Preview) to wygląda jak zawieszenie i zachęca do podwójnego kliknięcia.

Ten sam problem w Add File naprawiany w PR #81 (1b.09); tu dotyczy kodu z 1b.08, stąd osobne zadanie.

- Uwaga importu: strona odsyła do 1b.08 (kod) i 1b.09 (wzorzec), ale nie formułuje ich jako zależności — `depends_on` puste. Oba zadania są Done.

## Notatki z realizacji
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3e2c2fbc059581f084eee5e9b40f9310).
- 2026-09-22 tj (Preview, next 16.2.12): po zapisie New Revision okno znika ~1 s przed pojawieniem się rewizji na liście — ta luka należy do 1b.08b; okno ma zostać otwarte (stan „w toku”) do momentu, gdy odświeżona lista jest w DOM (reguła z 1b.09, 03-conventions).
- 2026-09-23: odczyt stanu bieżącego (pierwszy punkt Zakresu). `NewRevisionDialog.tsx` — przycisk już pokazywał spinner/„Creating…" od kliknięcia do odpowiedzi serwera (`actionPending`), ale `setOpen(false)` wywoływało się natychmiast, **przed** `startNavigation(() => router.push(...))` — dialog znikał, zanim przejście (jedyny nośnik `pending` w tym oknie) w ogóle się zaczęło; stąd luka z notatki wyżej. Dodatkowo okno miało własny `useTransition`, zamiast `navigate()` z `usePendingAction`. Przegląd pozostałych dialogów z zapisem na profilu dokumentu (punkt 4 Zakresu) — `VoidDocumentDialog.tsx` i `ApproveRevisionButton.tsx` mają **ten sam wzorzec błędu** (`setOpen(false)` przed `refresh()`); `DocumentStatusControl.tsx`, `RevisionStatusControl.tsx`, `CpyNumberField.tsx` nie mają okna do zamknięcia (kontrolki inline) — nie dotyczy ich.
- 2026-09-23 (tj): zgoda na naprawienie wszystkich trzech w tym PR (New Revision + Void + Approve), nie tylko New Revision — ten sam plik (profil dokumentu), ten sam kształt poprawki.
- 2026-09-23: naprawione wg wzorca `AddFileDialog.tsx` (1b.09) — `closeWhenNavigated`/`closeWhenRefreshed` + `shown = open && !(close… && !pending)`: okno zostaje otwarte, na etykiecie „w toku", aż `pending` z `usePendingAction` wróci do `false` (czyli drzewo się odświeżyło/nawigacja się zakończyła). `NewRevisionDialog.tsx` przeszło na `navigate()` hooka zamiast własnego `useTransition`. Efekt pobierający propozycję kodu przełączony z zależności `open` na `shown` — `open` nigdy nie wraca do `false` w nowym wzorcu (okno się nie domyka programowo), więc przy ponownym otwarciu z tym samym krokiem (np. A → B, oba IDC) efekt by się nie odpalił; `shown` przechodzi false→true przy każdym otwarciu i to jest poprawny sygnał.
- 2026-09-23: dowód przeglądarkowy dodany do `e2e:revision` (`apps/dcs/e2e/new-revision.mjs`) — `armSampler`/`fromClickToRow` (ten sam wzorzec co `revision-files.mjs` h, 1b.09): przy tworzeniu rewizji B żadna próbka między kliknięciem a nowym wierszem nie pokazuje okna zniknionego bez wskaźnika „Creating…" ani bez wiersza. Dowód podwójnego kliknięcia: `dblclick()` na „Create revision” przy tworzeniu czwartej rewizji (01) — dokładnie jeden nowy wiersz, potwierdzone odczytem `dcs.revisions`/`dcs.documents.current_revision_id`, nie dwa (01 i 02). `e2e:revision` 43/43 (40 istniejących + 3 nowe), `e2e:status` 27/27 (bez regresji na Void/Approve — te dwie kontrolki też przeszły przez poprawiony wzorzec), `e2e:profile` 40/40, `supabase test db` 1243/1243, `tsc --noEmit` i `eslint` czyste. Świeży `db reset` + fixtura przed każdym przebiegiem.
- 2026-09-23: dowód „w toku"/podwójnego kliknięcia dla Void i Approve **nie** dodany do `e2e:status` (poza formalnym Gotowe/gdy tego zadania, które nazywa tylko New Revision + `e2e:revision`) — `e2e:status` 27/27 potwierdza tylko brak regresji funkcjonalnej po poprawce. Jeśli tj chce tej samej rygorystyczności próbkowania DOM dla Void/Approve co dla New Revision, to osobny, mały follow-up na `e2e:status`.
- 2026-09-23 (tj): tak — ten sam sampler dla Void i Approve, przed zamknięciem PR-a; dowód RED na `origin/main` w osobnym worktree (jak dla New Revision), potem PASS na gałęzi, surowe liczby w raporcie; dodatkowo `e2e:pending` na buildzie produkcyjnym i tabela pokrycia `usePendingAction` w `03-conventions.md`.
- 2026-09-24: `armSampler`/`fromClickToTarget` dodane do `e2e:status` (`apps/dcs/e2e/manual-status.mjs`) — sekcja `c` (Approve, cel: tekst „Approved” w treści strony) i sekcja `d` (Void, cel: zapisany powód). Zastąpiono `page.waitForTimeout(1000)` przy obu kliknięciach przez `page.waitForFunction` na tekst docelowy + próbkowanie DOM od kliknięcia do jego pojawienia się.
  - **RED** (worktree `../scl-redproof` z `origin/main`, skrypt z samplerem skopiowany tam nieskomitowany, jak dla New Revision): `c/1b.08b` i `d/1b.08b` FAIL, oba z tym samym kształtem próbki co New Revision: `{"open":false,"indicator":false,"target":false}` — okno zniknięte, bez wskaźnika, bez celu. Reszta 27/29 (obie awarie to wyłącznie nowe asercje — funkcjonalność bez zmian). Worktree usunięty po (`git worktree remove --force`), nic stamtąd nie trafiło do gita.
  - **PASS** (gałąź, świeży `db reset` + fixtura, świeży build): `e2e:status` 29/29 (27 istniejących + 2 nowe), `2 samples from the click to the badge` / `2 samples from the click to the reason`.
  - `e2e:revision` przebiegnięte ponownie na gałęzi tym samym cyklem: 43/43, bez zmian względem 2026-09-23.
  - `e2e:pending` na buildzie produkcyjnym (gałąź): wszystkie 17 wierszy `PASS` (0 `not-committed`/`stuck-pending`/`not-stored`/`step-errors`), w tym `cpy` (30 prób) i `addfile` (30 prób) — te dwa dotykają `usePendingAction` bezpośrednio. Linia podsumowania: „All saves committed their tree and cleared their pending state.” (exit 0). Dwie linie „double-click … second click never got a clickable button” na `docform` to znany warunek wyścigu nawigacji tego skryptu (drugi klik trafia w moment, gdy strona już przeszła na `/documents/new`) — nie dotyczy `NewRevisionDialog`/`VoidDocumentDialog`/`ApproveRevisionButton` i nie jest regresją tego PR-a.
  - Zrzuty ekranu w osobnych katalogach na przebieg (`E2E_SHOTS`), żeby PASS nie nadpisał RED: pre-fix `e2e:status` w jednym katalogu, after-fix `e2e:status` i `e2e:revision` w dwóch kolejnych (ścieżki w scratchpadzie sesji agenta, nie w repo).
  - `docs/03-conventions.md` — tabela pokrycia `usePendingAction` (przy „Trzeci skrypt, `e2e:pending`"): dopisane wiersze `VoidDocumentDialog` i `ApproveRevisionButton` (dowód: `e2e:status`, sekcje `d`/`c`), wiersz `NewRevisionDialog` zaktualizowany o wzmiankę samplera z 1b.08b.
  - `status: review`, `pr: 92` ustawione w nagłówku tego pliku i w wierszu INDEX. Nie scalone — PR czeka na tj; CI PR-a #92 miało 3 kolejne awarie na limicie Docker Hub (bez związku ze zmianą, `docs/deferred-tasks.md` iii) — do ponownego uruchomienia, gdy limit się zresetuje.
- 2026-09-24 tj: odebrane (PR #92). Udowodnione: New Revision, Void i Approve zostają otwarte ze wskaźnikiem „w toku” do chwili, gdy odświeżony stan jest w DOM — red proof na origin/main (e2e:revision 42/43, e2e:status 27/29) → po poprawce 43/43 i 29/29; podwójny klik = jedna rewizja (e2e + SELECT); e2e:pending 17/17 bez zawieszeń; CI zielone.
