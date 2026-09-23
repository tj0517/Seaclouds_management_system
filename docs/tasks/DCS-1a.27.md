---
id: DCS-1a.27
title: "Skan sekretów w CI (gitleaks) — PR z kluczem w kodzie jest zatrzymany"
status: todo
kind: code             # code | client | ops | milestone
difficulty: S
model: null
model_approved: null
effort: null
branch: chore/ci-secret-scan
due: null
depends_on: []
blocked_by_questions: []
touches_db: false
touches_prod: false
pr: null
---

# DCS-1a.27 — Skan sekretów w CI

## Cel
Klucz (service_role, token Supabase, PAT GitHub) wklejony przez pomyłkę do kodu ma zatrzymać
PR automatycznie, zanim trafi do historii — merge do `main` to produkcja DCS **i** Timesheet,
a review łapie sekrety tylko w tym, co czyta. Decyzja tj 2026-09-22 (audyt agent-workflow).

## Zakres
- [ ] Odczyt stanu: `.github/workflows/ci.yml`, czy istnieje konfiguracja skanu
- [ ] Job `secrets` w `ci.yml` z gitleaks (akcja z przypiętą wersją/SHA): diff PR + pełna historia przy pierwszym uruchomieniu
- [ ] `.gitleaks.toml` z allowlistą tylko dla deterministycznych kluczy lokalnego stacku (jeśli są w repo), z komentarzem dlaczego
- [ ] Job wymagany w ochronie gałęzi `main` — **STOP**, ustawienia repo zmienia tj

## Gotowe, gdy
- czysty PR przechodzi — **jak sprawdzić**: zielony run joba `secrets` (`gh pr checks`)
- red proof: PR z fałszywym kluczem w formacie `sbp_…` jest czerwony — **jak sprawdzić**: link do czerwonego runu z gałęzi testowej (gałąź potem usunięta, PR zamknięty bez merge'a)
- pełna historia bez znalezisk albo znaleziska opisane — **jak sprawdzić**: wynik pierwszego runu w raporcie

## Poza zakresem
- rotacja kluczy (znalezisko → osobna decyzja tj, STOP)
- guard komend agenta (odpowiednik FA `agent-guard.sh`) — tj 2026-09-22: nie teraz

## Bramki STOP
- zmiana ochrony gałęzi (ustawienia repo)
- merge do `main` = wdrożenie produkcyjne DCS i Timesheet (CLAUDE.md)
- prawdziwy sekret w historii — stop i raport, bez przepisywania historii

## Kontekst
- `.github/workflows/ci.yml`
- `CLAUDE.md` §Deploy i produkcja
- `~/Documents/agent-workflow/core/security.md` §1, §S

## Notatki z realizacji
- 2026-09-22 tj: skan sekretów w CI (audyt agent-workflow).
