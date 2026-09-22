---
id: DCS-1a.20
title: "Potwierdzić backupy Supabase zgodnie z O-04"
status: todo
difficulty: S
model: null
model_approved: null
effort: null
branch: null
due: 2026-09-09
depends_on: []
blocked_by_questions: [O-04]
touches_db: false
touches_prod: TODO
pr: null
notion: https://app.notion.com/p/3c7c2fbc0595815aa9c8d9e6cd9893a1
---

# DCS-1a.20 — Potwierdzić backupy Supabase zgodnie z O-04

## Cel
Potwierdzić, że baza i pliki mają codzienną kopię zapasową z retencją zgodną z briefem (§3.5: codziennie, minimum 30 dni) i O-04, oraz opisać przywracanie.

## Zakres
- [ ] Odczyt stanu bieżącego (dodane przy imporcie)
- [ ] Sprawdzić plan Supabase projektu `timesheet` — daily backups są w Pro; PITR opcjonalnie
- [ ] Potwierdzić, że Storage (pliki dokumentów w 1b) jest objęty backupem, albo zaplanować osobną replikację bucketu
- [ ] Zapisać w rejestrze decyzji: plan, retencja, kto ma dostęp do przywracania
- [ ] Krótki runbook „jak przywrócić” w `docs/` repo (2–3 akapity)

## Gotowe, gdy
- Backupy widoczne w panelu Supabase z retencją ≥ 30 dni — **jak sprawdzić**: panel Supabase (strona nie mówi więcej)
- Runbook w repo — **jak sprawdzić**: TODO

## Poza zakresem
—

## Bramki STOP
—

## Kontekst
Brief (§3.5): kopia zapasowa bazy i plików codziennie, retencja minimum 30 dni. Okres retencji do potwierdzenia przez MD (O-04).

- Strona mówi o projekcie Supabase `timesheet` — w repo projekt produkcyjny to `tfbzivfsqsgebegcvfah`; nazwa do potwierdzenia przy realizacji.

## Notatki z realizacji
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3c7c2fbc0595815aa9c8d9e6cd9893a1).
