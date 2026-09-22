---
id: DCS-1b.04b
title: "New Document: stan „w toku”, projekt z kontekstu, informacja o nawigacji w toku"
status: done
difficulty: S
model: null
model_approved: null
effort: null
branch: feat/dcs-1b04b-pending-navigation
due: 2026-09-29
depends_on: []
blocked_by_questions: []
touches_db: false
touches_prod: false
pr: 85
---

# DCS-1b.04b — New Document: stan „w toku”, projekt z kontekstu, informacja o nawigacji w toku

## Cel
Formularz New Document i nawigacja w aplikacji DCS nie dają dziś informacji zwrotnej: zapis nie pokazuje, że trwa, a klik w dokument na liście nic nie zmienia na ekranie do czasu załadowania. Do tego New Document otwarty z kontekstu projektu nie ma tego projektu wybranego. Sukces: użytkownik zawsze widzi, że coś się dzieje, nie wyśle formularza dwa razy i nie musi drugi raz wybierać projektu, z którego przyszedł.

## Zakres
- [ ] Odczyt stanu bieżącego: formularz New Document (1b.04), linki na liście Documents, co zostało po usunięciu `(app)/loading.tsx` w 1b.07b (PR #79)
- [ ] New Document — przycisk zapisu: stan „w toku” (disabled + etykieta/spinner) od kliknięcia do końca zapisu, ochrona przed podwójnym wysłaniem; ten sam wzorzec co 1b.08b / Add File z 1b.09
- [ ] New Document otwarty z kontekstu projektu X ma projekt X ustawiony w formularzu (np. parametr w URL); otwarty z widoku globalnego — bez zmian
- [ ] Nawigacja w toku: pasek postępu u góry i/lub stan ładowania na klikniętym linku (Documents → profil dokumentu i podobne przejścia)
- [ ] Klikanie w trakcie ładowania zostaje dozwolone — wygrywa ostatnia nawigacja; nie blokować interfejsu

## Gotowe, gdy
- Zapis New Document pokazuje stan „w toku” od kliknięcia do końca — **jak sprawdzić**: dowód przeglądarkowy na buildzie produkcyjnym (Preview)
- Podwójne kliknięcie zapisu nie tworzy dwóch dokumentów — **jak sprawdzić**: dowód w bazie (liczba wierszy dcs.documents przed/po)
- New Document otwarty z projektu X ma X wybrany; z widoku globalnego pole jest puste jak dotąd — **jak sprawdzić**: dowód przeglądarkowy, oba wejścia
- Klik w dokument na liście od razu pokazuje ładowanie; klik w „New Document” w trakcie przenosi tam bez błędu i bez zawieszenia — **jak sprawdzić**: dowód przeglądarkowy na buildzie produkcyjnym, konsola bez błędów
- Brak regresji 1b.07b: zapis numeru CPY w profilu nie wisi na „Saving…” — **jak sprawdzić**: dowód przeglądarkowy na buildzie produkcyjnym + istniejące e2e zielone

## Poza zakresem
- stan „w toku” w New Revision → DCS-1b.08b
- wyścig hydratacji po logowaniu/MFA → DCS-1b.09b
- blokowanie klików w trakcie nawigacji — decyzja tj: nie blokujemy
- zmiany w bazie — żadnych

## Bramki STOP
- przed przywróceniem `loading.tsx` (w dowolnym segmencie) — pokaż, dlaczego nie wraca zawieszenie z 1b.07b, i czekaj na akceptację

## Kontekst
- `docs/tasks/DCS-1b.08b.md` — ten sam wzorzec stanu „w toku”, robić jedno po drugim
- PR #79 (1b.07b) — dlaczego usunięto `(app)/loading.tsx` i `admin/projects/[projectId]/loading.tsx`
- PR #81 (1b.09) — wzorzec stanu „w toku” w Add File

## Notatki z realizacji
- 2026-09-22 tj: zgłoszone przy teście Preview po migracji 1b.11 (PR #84) — trzy punkty: brak stanu ładowania w New Document, New Document z projektu X nie ustawia projektu, brak informacji zwrotnej przy klikaniu w trakcie ładowania.
- 2026-09-22 tj: trzy punkty w jednym zadaniu (nie rozbijać).
- 2026-09-22 tj: klikanie w trakcie ładowania zostaje dozwolone; pokazać ładowanie zamiast blokować.
- 2026-09-22: odbiór — PR #85 zmergowany 22.09 (20c6799); kod i testy (resolveProjectFromParam 5 przypadków, e2e docform: podwójny klik = 1 dokument, przerwanie nawigacji 5×) w repo; tj sprawdził na Preview (scl-dev, konto DC): projekt z kontekstu, podwójny klik → jeden dokument, ładowanie przy klikniętym wierszu. Zmiana: New Document z widoku globalnego startuje z pustym projektem (wcześniej projects[0]) — decyzja tj 22.09. Status done.
