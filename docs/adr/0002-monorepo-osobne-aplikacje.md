# ADR-0002 — Monorepo z osobnymi aplikacjami zamiast segmentu `/dcs`

## Kontekst

DCS mógł powstać jako segment tras `/dcs` wewnątrz istniejącej aplikacji
Timesheet (jeden deploy, wspólny kod od razu) albo jako osobna aplikacja.
Timesheet niesie dług techniczny (nietypowany klient przeglądarkowy,
~182 warningi lintera z obniżonymi regułami), którego DCS nie ma dziedziczyć.
Docelowo portal ma trzy moduły (DCS, TES, QMS) pod `scl.seaclouds.eu`.

## Decyzja

Monorepo pnpm + Turborepo: `apps/timesheet` i `apps/dcs` jako osobne
aplikacje Next.js, wspólny kod w `packages/*` (na start `@scl/db`).
Katalog projektu Supabase wyłącznie w rootcie repo (guard w CI).
Zrealizowane: PR #2 (przeniesienie appki), PR #3 (Vercel env), PR #4
(`packages/db`), PR #5 (CI).

## Konsekwencje

- DCS startuje z czystą konfiguracją lintera i typowanym klientem — dług
  TES pozostaje odizolowany w `apps/timesheet`.
- Osobne deploye Vercel per aplikacja (Root Directory); wspólny build przez
  `turbo run build` w trybie strict env — zmienne budowe deklarowane
  w `turbo.json`.
- Kod wspólny musi świadomie trafiać do `packages/*`, nie przez importy
  między aplikacjami.
- Jedna wersja narzędzi dla całego repo (`docs/toolchain.md`).

## Data / Status

2026-08-28 (PR #2 zmergowany) / przyjęta
