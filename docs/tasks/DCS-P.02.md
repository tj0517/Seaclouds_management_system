---
id: DCS-P.02
title: "Wydanie briefu SCMS-SCL-SA-0001-PL rev. B (usunięcie sprzeczności)"
status: todo
kind: client             # code | client | ops | milestone
difficulty: M
model: null
model_approved: null
effort: null
branch: null
due: 2026-11-20
depends_on: []
blocked_by_questions: []
touches_db: false
touches_prod: false
pr: null
notion: https://app.notion.com/p/3ccc2fbc059581ab91e2d0bc7cea6441
---

# DCS-P.02 — Wydanie briefu SCMS-SCL-SA-0001-PL rev. B (usunięcie sprzeczności)

## Cel
Wydanie briefu SCMS-SCL-SA-0001-PL rev. B z usuniętymi sprzecznościami. **Krytyczne — brief jest podstawą umowy, a sam sobie przeczy.**

## Zakres
- [ ] Odczyt stanu bieżącego (dodane przy imporcie)
- [ ] §1.3 usunąć QMS, zostawić BMS
- [ ] §3.1 poprawić SCL-QMS na SCL-BMS i literówkę „Businness”
- [ ] §3.2 opisać TES jako system istniejący z użytkownikami, projektami i CTR
- [ ] §3.3 przywrócić wiersz o regionie hostingu UE
- [ ] Przywrócić sekcję o granicy DCS–BMS (D-26 wskazuje na nieistniejącą 3.3)
- [ ] §2.1 usunąć odesłanie do nieistniejącej sekcji 2.4
- [ ] §8.3.2 i §8.3.3 uzgodnić z regułą z §4
- [ ] §11 przenieść import z M14 do opcji
- [ ] §12 harmonogram i obsada
- [ ] §12.2 poprawić odesłanie 3.6.1 na 3.5
- [ ] §13 zakres weryfikacji na SC2505 i SC2602
- [ ] §14 zaktualizować D-14, D-22, D-25, D-26
- [ ] §16 zamknąć O-02, przepiąć terminy
- [ ] Wydanie rev. B

## Gotowe, gdy
—

## Poza zakresem
—

## Bramki STOP
- Sprzeczność §8.3.2/§8.3.3 vs §4 (Planned vs Forecast) do rozstrzygnięcia przed `2.12` i `2.14` (wg strony Notion).

## Kontekst
- **Źródło: plan klienta `P.02`.**
- Najważniejsza sprzeczność merytoryczna: §8.3.2 i §8.3.3 opisują przeliczanie dat **Planned**, podczas gdy §4 mówi, że Planned ustawia się jednorazowo, a zmiany idą w **Forecast**. Do rozstrzygnięcia przed `2.12` i `2.14`.
- O-02 (TES jako core) jest w repo rozstrzygnięte (ADR-0001) — punkt „§16 zamknąć O-02” nie blokuje zadania.
- Ref: cały dokument · Właściciel wg planu klienta: EJE

## Notatki z realizacji
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3ccc2fbc059581ab91e2d0bc7cea6441).
