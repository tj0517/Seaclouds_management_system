# docs/tasks — format zadania DCS

Jedno zadanie to jeden plik markdown w repo projektu: `<tasks.dir>/<PREFIX>-<etap>.<nn>.md`,
na przykład `docs/tasks/FA-1.03.md` albo `docs/tasks/DCS-1b.10.md`. Plik zadania jest
jedynym źródłem prawdy o zadaniu. INDEX to tylko widok.

Rozszerzenie DCS: pole `notion:` — link do strony źródłowej dla zadań zaimportowanych
z Notion 2026-09-22 (tylko historia; Notion nie jest już źródłem zadań).

Rozszerzenie DCS (2026-09-23): pole `kind:` — rodzaj pracy, zaraz pod `status:`.
INDEX liczy z niego linię „Postęp kodu” i dzieli tablicę na kod i resztę.

| kind | znaczenie |
|---|---|
| `code` | wynikiem jest PR z kodem, migracją, testem albo skryptem |
| `client` | czeka na decyzję lub materiał od Sea Clouds (punkty otwarte, szablony, procedury) |
| `ops` | praca poza repo: backupy, RODO, instrukcje, szkolenia, testy z użytkownikami |
| `milestone` | odbiór etapu (kamień milowy) |

## Frontmatter

```yaml
---
id: DCS-1b.10
title: Blokada rewizji finalnych
status: todo            # todo | in_progress | review | blocked | done | dropped
kind: code              # code | client | ops | milestone (rozszerzenie DCS)
difficulty: M           # S | M | L | XL
model: null             # model agenta, wypełniany przy składaniu promptu
model_approved: null    # np. "fable by tj 2026-09-22", tylko gdy polityka wymaga zgody
effort: null
branch: null            # np. feat/revision-lock
due: null               # RRRR-MM-DD, jeśli jest termin
depends_on: []          # id zadań
blocked_by_questions: [] # id otwartych pytań, np. [O-16]
touches_db: false
touches_prod: false
pr: null                # numer PR po otwarciu
---
```

## Sekcje (w tej kolejności)

```markdown
## Cel
2–5 zdań: po co to zadanie, jaki problem rozwiązuje, jak wygląda sukces z punktu widzenia produktu.

## Zakres
- [ ] odczyt stanu bieżącego tego, czego dotyczy zadanie (zawsze pierwszy punkt)
- [ ] …

## Gotowe, gdy
- kryterium — **jak sprawdzić** (komenda, zapytanie, test, co ma być widać)
- …

## Poza zakresem
- rzecz kusząca po drodze → do którego zadania należy

## Bramki STOP
- przed <czynność> — pokaż <co> i czekaj na akceptację

## Kontekst
- ścieżka — po co

## Notatki z realizacji
(dopisywane w trakcie: decyzje tj z datą, PR, co odłożono)
```

## Zasady

- Każde kryterium w „Gotowe, gdy” ma sposób sprawdzenia. Kryterium bez niego to życzenie.
- Każdy nowy mechanizm kontrolny ma w kryteriach red proof.
- Decyzje tj podjęte w trakcie trafiają do „Notatek z realizacji” z datą, na przykład
  `2026-09-21 tj: przejście → SUPERSEDED zawsze dozwolone`. Dzięki temu następny prompt
  i review wiedzą, co już rozstrzygnięto.
- Język treści zadania jest taki, jak pisze tj (zwykle polski). Prompt do agenta i tak
  idzie po angielsku, bo tłumaczy go wf-task.

## INDEX.md

Tabele: kod otwarty `| id | tytuł | status | trudność | zależności | pytania | due |`, reszta z kolumną `rodzaj` (kind). Na górze linia „Postęp kodu”. INDEX jest
widokiem dla ludzi. Przy rozbieżności rozstrzyga plik zadania, a skill proponuje
poprawkę INDEX.
