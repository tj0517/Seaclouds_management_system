---
id: DCS-1b.16
title: "Odbiór Fazy 1: testy RLS dcs.* w CI, migracje na czystej bazie, backupy, kod w repo Sea Clouds, rev. 2 procedury KQ-0001 po stronie klienta"
status: todo
kind: milestone             # code | client | ops | milestone
difficulty: S
model: null
model_approved: null
effort: null
branch: null
due: 2026-09-30
depends_on: []
blocked_by_questions: [O-04]
touches_db: TODO
touches_prod: true
pr: null
notion: https://app.notion.com/p/3c7c2fbc059581e987eddbef73c4a57d
---

# DCS-1b.16 — Odbiór Fazy 1: testy RLS dcs.* w CI, migracje na czystej bazie, backupy, kod w repo Sea Clouds, rev. 2 procedury KQ-0001 po stronie klienta

## Cel
Formalne zamknięcie Fazy 1 — lista kontrolna z kryteriów wyjścia zapisanych na stronie projektu. Część punktów jest po stronie klienta.

## Zakres
- [ ] Odczyt stanu bieżącego: które punkty listy są już spełnione (dodane przy imporcie)

Checklist techniczny:
- [ ] Testy RLS dla `dcs.documents`, `dcs.revisions`, `dcs.files` w CI (użytkownik spoza projektu, ORIG vs DC, anon)
- [ ] Test atomowości generatora numerów w CI
- [ ] Test blokady rewizji finalnych w CI
- [ ] Migracje odtwarzają bazę od zera (`supabase db reset` + seed → aplikacja działa)
- [ ] `supabase db diff` pusty względem prod
- [ ] Advisor security bez ostrzeżeń
- [ ] Backupy działają, retencja zgodna z O-04, runbook w `docs/`
- [ ] Kod w repo w organizacji Sea Clouds, `CLAUDE.md` / README zaktualizowane o moduł DCS
- [ ] Deploy prod na Vercel z env prod; dev i prod rozdzielone (§12.2: dane produkcyjne nie trafiają na dev)

Po stronie klienta:
- [ ] Rev. 2 procedury SCMS-SCL-KQ-0001 wydana (brief §15: zmiany Z-01…Z-08, najpóźniej przed końcem 1b)
- [ ] Demo 1a+1b dla DC i MD wg `docs/demo/1a21-demo-script.md` (przejęte z DCS-1a.21), przed mailem odbioru
- [ ] Mail potwierdzający odbiór Fazy 1 od MD

## Gotowe, gdy
- Wszystkie checkboxy odhaczone — **jak sprawdzić**: TODO
- Faktura za Fazę 1 wystawiona — **jak sprawdzić**: TODO

## Poza zakresem
Obieg IDC/IFR, komentarze, przeliczanie dat, My Page, transmittale, powiadomienia — Fazy 2–3 (przypomnieć przy odbiorze).

## Bramki STOP
—

## Kontekst
Formalne zamknięcie Fazy 1 — lista kontrolna z kryteriów wyjścia zapisanych na stronie projektu. Część punktów jest po stronie klienta.

- O-04 (retencja audit logu i kopii — RODO) otwarte; punkt „retencja zgodna z O-04” od niego zależy.
- Uwaga importu: strona nie wymienia numerów zadań, choć punkty pokrywają się z 1a.20 (backupy, runbook), 1b.02 (atomowość generatora), 1b.10 (blokada rewizji finalnych) i P.01 (rev. 2 KQ-0001) — `depends_on` puste zgodnie z zasadą „tylko wprost”.

## Notatki z realizacji
- 2026-09-23 tj: demo/bramka 1a (DCS-1a.21) scalona z tym odbiorem. Uwaga: import SMDR (1b.13–1b.15, kamień milowy „Excel przestaje być źródłem prawdy”) odłożony — zakres odbioru 30.09 do ustalenia z klientem.
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3c7c2fbc059581e987eddbef73c4a57d).
