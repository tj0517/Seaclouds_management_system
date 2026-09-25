---
id: DCS-1b.26
title: "Numer wykonawcy (contractor) na dokumencie — trzeci numer obok SCL i CPY"
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
touches_db: true
touches_prod: false
pr: null
---

# DCS-1b.26 — Numer wykonawcy (contractor) na dokumencie

## Cel
Dokument może mieć trzy numery: SCL (nadaje system), CPY (numer klienta) i numer wykonawcy (contractor). Dwa ostatnie wpisuje ręcznie DC. Dziś nie ma miejsca na numer wykonawcy. Po zadaniu DC wpisuje go w profilu dokumentu, a numer jest widoczny w profilu, w kolumnie MDR i w szukaniu.

## Zakres
- [ ] Odczyt stanu bieżącego: jak działa numer CPY — kolumna `dcs.documents.cpy_doc_number`, unikalność `(project_id, cpy_doc_number)`, `CpyNumberField`, polityka UPDATE, audyt, widok `dcs.v_mdr`, kolumny i szukanie w `apps/dcs/lib/mdr.ts`, zachowanie na dokumencie Void
- [ ] Kolumna `dcs.documents.contractor_doc_number` (tekst, opcjonalna), unikalna w projekcie jak CPY; pusty napis zapisywany jako brak wartości
- [ ] Edycja w profilu dokumentu przez DC projektu i admina, tym samym wzorcem co numer CPY; bez przełącznika per projekt i bez rewizji wykonawcy
- [ ] Widoczny w profilu (Document information), jako kolumna MDR obok „Company Doc. Number” i w szukaniu MDR
- [ ] Typy regenerowane (`pnpm db:gen`)

## Gotowe, gdy
- DC wpisuje i zmienia numer wykonawcy; numer widać w profilu i w kolumnie MDR, szukanie po nim znajduje dokument — **jak sprawdzić**: dowód przeglądarkowy na buildzie produkcyjnym lokalnie, stan „w toku” do momentu, gdy odświeżone dane są w DOM
- red proof: zwykły członek projektu i DC innego projektu nie zmienią numeru — **jak sprawdzić**: test pgTAP
- red proof: ten sam numer drugi raz w tym samym projekcie odrzucony przez bazę — **jak sprawdzić**: test pgTAP
- zmiana zostawia ślad w `public.audit_log` — **jak sprawdzić**: test pgTAP albo SELECT lokalnie, wynik w raporcie
- na dokumencie Void pole zachowuje się jak numer CPY — **jak sprawdzić**: asercja w teście albo dowód w UI
- typy aktualne — **jak sprawdzić**: CI (sprawdzenie stale types) zielone

## Poza zakresem
- kolumna numeru wykonawcy w eksporcie Excel → 3.05 (układ eksportu dyktuje klient)
- rewizja wykonawcy i przełącznik numeracji per projekt — tj 2026-09-25: nie
- edycja numeru w oknie „Edit document” → może przejąć 1b.22
- zakładka MDR projektu → 1b.25

## Bramki STOP
- przed migracją zmieniającą `dcs.v_mdr`, indeks szukania albo politykę UPDATE na `dcs.documents` — pokaż diff względem baseline i czekaj na akceptację
- merge do `main` = produkcja DCS i Timesheet

## Kontekst
- `CLAUDE.md`, `docs/03-conventions.md`, `docs/02-data-model.md`, `docs/00-glossary.md` (SCL, CPY)
- `apps/dcs/components/document-profile/CpyNumberField.tsx`, `apps/dcs/lib/mdr.ts`
- Najlepiej po 1b.25 (ten sam kod MDR) — kolejność, nie zależność

## Notatki z realizacji
- 2026-09-25 tj: ustalenie z klientem — dokument może mieć 3 numery (contractor, client, DCS); contractor i client wpisywane ręcznie. Numer wykonawcy: jedno pole na dokumencie, wpisuje DC, bez rewizji.
