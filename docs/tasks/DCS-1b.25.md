---
id: DCS-1b.25
title: "MDR projektu jako zakładka na stronie projektu (obok listy dokumentów)"
status: todo
kind: code             # code | client | ops | milestone
difficulty: M
model: null
model_approved: null
effort: null
branch: null
due: null
depends_on: []
blocked_by_questions: []
touches_db: false
touches_prod: false
pr: null
---

# DCS-1b.25 — MDR projektu jako zakładka na stronie projektu

## Cel
Klient oczekuje, że po otwarciu projektu MDR pokazuje zawartość **tego** projektu, a nie rejestr globalny. Dziś MDR jest jeden (`/mdr`, filtr projektu w adresie), a strona projektu ma tylko prostą listę dokumentów. Po zadaniu strona projektu ma zakładkę „MDR” z tymi samymi kolumnami, filtrami, sortowaniem, szukaniem i eksportem co `/mdr`, ale zamkniętą na ten projekt. Lista dokumentów zostaje jako osobna zakładka, globalny `/mdr` bez zmian.

## Zakres
- [ ] Odczyt stanu bieżącego: `apps/dcs/app/(app)/mdr/page.tsx`, `apps/dcs/lib/mdr.ts` (`listMdrPage`, `parseMdrSearchParams`, `mdrHref`), `MdrToolbar` (zapisane widoki, eksport), `apps/dcs/app/(app)/projects/[projectId]/documents/page.tsx`
- [ ] Zakładki na stronie projektu: „Documents” (dotychczasowa lista) i „MDR”
- [ ] Rejestr projektu: projekt bierze się ze ścieżki adresu; filtr projektu ukryty i nie do nadpisania parametrem
- [ ] Linki sortowania, stron i filtrów zostają w obrębie strony projektu
- [ ] Eksport do Excela z zakładki obejmuje tylko ten projekt
- [ ] Zapisane widoki działają w zakładce, ale projekt zawsze narzuca ścieżka (widok zapisany z innym projektem nie wyprowadza poza projekt)

## Gotowe, gdy
- zakładka MDR pokazuje tylko dokumenty tego projektu — **jak sprawdzić**: dowód przeglądarkowy na buildzie produkcyjnym lokalnie (fixture z dokumentami w co najmniej dwóch projektach): liczba wierszy = `select count(*) from dcs.documents where project_id = …`
- red proof: dopisanie do adresu `?project=<inny projekt>` nie pokazuje dokumentów innego projektu — **jak sprawdzić**: asercja w skrypcie `e2e:*` albo Playwright, z wynikiem w raporcie
- linki sortowania, stron i filtrów nie wychodzą poza `/projects/<id>/…` — **jak sprawdzić**: asercja na `href` w skrypcie
- eksport z zakładki zawiera tylko wiersze tego projektu — **jak sprawdzić**: pobrany plik, liczba wierszy danych = liczba dokumentów projektu
- `/mdr` i lista „Documents” działają jak przed zmianą — **jak sprawdzić**: istniejące skrypty `e2e:*` dotykające tych ekranów zielone + zrzuty przed/po

## Poza zakresem
- numer wykonawcy (kolumna) → 1b.26
- zmiany RLS — widoczność dokumentów rozstrzyga baza, bez zmian
- zmiany globalnego `/mdr` i nowe kolumny
- kolumny eksportu w formacie klienta → 3.05

## Bramki STOP
- merge do `main` = produkcja DCS i Timesheet

## Kontekst
- `CLAUDE.md`, `docs/03-conventions.md` (stany ładowania, testy przeglądarkowe)
- `apps/dcs/app/(app)/mdr/page.tsx`, `apps/dcs/lib/mdr.ts`, `apps/dcs/components/MdrToolbar.tsx`
- `apps/dcs/app/(app)/projects/[projectId]/documents/page.tsx`

## Notatki z realizacji
- 2026-09-25 tj: ustalenie z klientem — po otwarciu projektu MDR odnosi się do zawartości projektu. Wariant: zakładka MDR obok listy dokumentów; globalny `/mdr` zostaje.
