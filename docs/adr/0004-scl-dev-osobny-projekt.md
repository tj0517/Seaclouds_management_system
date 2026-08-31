# ADR-0004 — scl-dev jako osobny projekt Supabase, nie branch

## Kontekst

Potrzebne było środowisko integracyjne między lokalnym stackiem a produkcją.
Supabase oferuje branching (branch bazy w ramach projektu) albo zwykły drugi
projekt. Brief (§12.2) wymaga rozdzielenia środowisk i zakazuje kopiowania
danych produkcyjnych do środowiska deweloperskiego.

## Decyzja

`scl-dev` to osobny, pełnoprawny projekt Supabase (ref `mzotiurydmhibqhxxzoh`,
org Seaclouds, eu-west-1), zbudowany z tych samych migracji co prod.
Nie używamy Supabase branchingu.

## Konsekwencje

- Twarda izolacja od proda: osobne klucze, osobne hasło DB, osobny token —
  co umożliwia scoping tokenów CI
  ([ADR-0005](0005-tokeny-ci-per-projekt.md)); kompromitacja dev nie dotyka
  prodowych danych.
- Ten sam mechanizm wdrożenia (`supabase db push`) na dev i prod — dev
  faktycznie testuje ścieżkę wdrożenia, nie jej symulację.
- Dane na scl-dev są seedowane/testowe; zgodność z zasadą „bez danych
  produkcyjnych w dev”.
- Koszt drugiego projektu i ręczna dbałość o zbieżność konfiguracji
  (config.toml — patrz `docs/deferred-tasks.md` a).

## Data / Status

2026-08-27 (projekt utworzony, baseline zaaplikowany) / przyjęta
