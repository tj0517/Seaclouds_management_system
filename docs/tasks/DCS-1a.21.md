---
id: DCS-1a.21
title: "Demo / bramka 1a→1b: login 2FA, role w SC2601, nowy projekt w kreatorze, edycja słownika, audit log"
status: todo
difficulty: S
model: null
model_approved: null
effort: null
branch: null
due: 2026-09-09
depends_on: []
blocked_by_questions: []
touches_db: false
touches_prod: false
pr: null
notion: https://app.notion.com/p/3c7c2fbc059581a380cff7ebfb727056
---

# DCS-1a.21 — Demo / bramka 1a→1b: login 2FA, role w SC2601, nowy projekt w kreatorze, edycja słownika, audit log

## Cel
Demonstracja Fazy 1a dla DC i MD i formalna bramka 1a → 1b — bez jej zamknięcia nie zaczynamy tabel `dcs.*`.

## Zakres
- [ ] Odczyt stanu bieżącego (dodane przy imporcie)
- [ ] Demo wg scenariusza (dla DC i MD, ~30 min):
  1. Logowanie jako admin z 2FA
  2. Przełączenie do modułu DCS
  3. Nadanie ról w projekcie SC2601 (ORIG, CHK, APP, DC)
  4. Założenie nowego projektu w kreatorze Create Project MDR (klient, cykl, zespół, CTR, budżet)
  5. Edycja słownika — dodanie typu dokumentu, dezaktywacja obszaru
  6. Podgląd audit logu z powyższych zmian
  7. Logowanie jako zwykły pracownik — pokazać, czego NIE widzi
- [ ] Warunki zamknięcia bramki:
  - [ ] DC samodzielnie powtarza punkty 3–5 bez pomocy
  - [ ] Testy RLS zielone w CI
  - [ ] 14 projektów w bazie z klientem i zespołem
  - [ ] Advisor Supabase bez ostrzeżeń security
  - [ ] Lista uwag z demo zapisana jako taski (poprawki wchodzą równolegle z 1b)

## Gotowe, gdy
- Klient potwierdza mailem odbiór 1a — **jak sprawdzić**: mail od klienta (strona nie mówi więcej)

## Poza zakresem
—

## Bramki STOP
—

## Kontekst
Brief (§12.2): demonstracja co dwa tygodnie; Faza 1a przed 1b, bo wszystko w DCS siedzi na core. To jest bramka — bez jej zamknięcia nie zaczynamy tabel `dcs.*`.

- Uwaga importu: warunek „14 projektów w bazie z klientem i zespołem” odpowiada zakresowi DCS-1a.19 (To Do), ale strona nie wymienia 1a.19 wprost, więc `depends_on` puste.
- Uwaga importu: strona mówi „bez jej zamknięcia nie zaczynamy tabel `dcs.*`”, a tabele `dcs.*` już istnieją (1b.01 i dalsze Done) — bramka została w praktyce ominięta.

## Notatki z realizacji
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3c7c2fbc059581a380cff7ebfb727056).
