---
id: DCS-1b.17
title: "Foldery rewizji w storage (projekt / dokument / rewizja, tworzone automatycznie)"
status: dropped
kind: code             # code | client | ops | milestone
difficulty: L
model: null
model_approved: null
effort: null
branch: null
due: 2026-09-22
depends_on: [DCS-1b.09]
blocked_by_questions: []
touches_db: TODO
touches_prod: false
pr: null
notion: https://app.notion.com/p/3ccc2fbc05958187b96ffa00bfc43191
---

# DCS-1b.17 — Foldery rewizji w storage (projekt / dokument / rewizja, tworzone automatycznie)

## Cel
Każda rewizja ma własny folder w storage (brief §2.1: TWORZENIE FOLDERÓW REWIZJI wraz z plikami) — struktura projekt / dokument / rewizja, tworzona automatycznie.

## Zakres
- [ ] Odczyt stanu bieżącego: co z tej struktury już dostarczyło 1b.09 (dodane przy imporcie)
- [ ] Struktura folderów: projekt / dokument / rewizja
- [ ] Automatyczne tworzenie folderu przy nowej rewizji
- [ ] Zachowanie nazwy oryginalnej pliku jako metadanej
- [ ] Wiele plików w jednej rewizji

## Gotowe, gdy
- jak sprawdzić: TODO — strona nie ma sekcji „Gotowe, gdy”; jedynym materiałem są punkty zakresu powyżej

## Poza zakresem
—

## Bramki STOP
—

## Kontekst
**Źródło: plan klienta `1b.12`. Nasze `1b.09` opisuje pliki i nazewnictwo, ale nie strukturę folderów.**
Brief §2.1 wymaga TWORZENIA FOLDERÓW REWIZJI wraz z plikami — każda rewizja ma własny folder w storage.

Termin ustawiony na nasze okno Fazy 1b (razem z `1b.09` Pliki), a nie na 09.10 z planu klienta — tam wypadałby po odbiorze naszej Fazy 1.

Ref: brief sekcje 2.1, 6.6 · Właściciel wg planu klienta: TJE

- Uwaga importu: „1b.12” w źródle to numer z planu klienta, nie nasze DCS-1b.12 (analiza SMDR).
- Uwaga importu: wg decyzji z 1b.09 (niżej) ścieżka obiektu już ma postać projekt / dokument / rewizja, a `original_name` i wiele plików (NN) w rewizji są zrobione — zakres tego zadania może być w dużej części pokryty; do ustalenia odczytem.

## Notatki z realizacji
- 2026-09-23 tj: dropped — pokryte przez DCS-1b.09: obiekty w buckecie dcs-documents mają klucz {project_code}/{scl_doc_number}/{scl_revision}/{file_name} (apps/dcs/lib/files.ts, revisionFolder/objectPath), original_name i wiele plików (NN) w rewizji działają; w Supabase Storage folder powstaje z pierwszym plikiem.
- przed 2026-09-22 (z DCS-1b.09): bucket `dcs-documents` (private), ścieżka `{project_code}/{scl_doc_number}/{revision}/{file_name}`.
- 2026-09-21 (z DCS-1b.09): PR #80 — bucket `dcs-documents` prywatny, 100 MB, bez białej listy MIME, 5 polityk storage, NOT NULL na `file_name`/`original_name`/`storage_path`, globalny limit Storage 100 MiB; na prod wdrożone ręcznie przez tj (`db push` + `config push`).
- 2026-09-21 (z DCS-1b.09): PR #81 — nazwa wg §6.6 (`revision_date`, fallback data uploadu UTC; NN kolejne w rewizji; rozszerzenie lowercase); oryginalna nazwa jako `original_name`.
- 2026-09-21 (z DCS-1b.09): O-16 zawężone — bajty plików tylko dla ról DCS (+ admin); metadane w `dcs.files` nadal widoczne dla przypisanych w TES (otwarte pytanie do DC).
- 2026-09-21 (z DCS-1b.09): nowa reguła w `03-conventions.md` — stany ładowania do momentu, gdy odświeżone dane są w DOM; wyzwalacz zablokowany; dowód na buildzie produkcyjnym.
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3ccc2fbc05958187b96ffa00bfc43191).
