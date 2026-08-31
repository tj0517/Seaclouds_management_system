# ADR-0003 — Osobny schemat `dcs` w tej samej bazie

## Kontekst

Tabele DCS mogły trafić do wspólnego `public` (jak TES), do osobnej bazy /
osobnego projektu Supabase, albo do osobnego schematu w istniejącej bazie.
Wymagania: klucze obce do tabel wspólnych (profiles, projects,
sub_projects), jedno logowanie, RLS w jednej bazie; jednocześnie kilkanaście
nowych tabel DCS nie może zamazać granicy modułów w `public`.

## Decyzja

Jeden projekt Supabase (jedna baza Postgres) dla całego portalu — zgodnie
z D-06 briefu. Tabele DCS w dedykowanym schemacie `dcs`, obok `public`.
Odwołania do warstwy wspólnej wyłącznie przez klucze obce do `public.*`
([ADR-0001](0001-reuzycie-tes-jako-core.md)); żadnej duplikacji danych.
Przyszły QMS dostanie analogicznie własny schemat.

## Konsekwencje

- FK i RLS między modułami działają natywnie (jedna baza).
- Granica modułu widoczna w każdym zapytaniu (`dcs.documents`), a uprawnienia
  można nadawać per schemat.
- Schemat `dcs` musi zostać dodany do `schemas` w `[api]`
  w `supabase/config.toml`, żeby PostgREST go wystawiał, a `gen types`
  generował typy (patrz [03-conventions.md](../03-conventions.md)).
- Wspólna pula zasobów bazy: ciężkie operacje DCS (import 146 dokumentów,
  raporty) dzielą instancję z produkcyjnym TES.

## Data / Status

2026-08-27 (planowanie SCL Portal; platforma per D-06 briefu z 2026-08-18) / przyjęta
