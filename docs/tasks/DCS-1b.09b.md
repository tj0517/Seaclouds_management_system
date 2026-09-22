---
id: DCS-1b.09b
title: "Wyścig hydratacji po logowaniu/MFA (React #418 na liście akcji profilu dokumentu)"
status: in_progress
difficulty: L
model: null
model_approved: null
effort: null
branch: fix/dcs-1b09b-hydration-race
due: 2026-09-29
depends_on: []
blocked_by_questions: []
touches_db: false
touches_prod: false
pr: null
notion: https://app.notion.com/p/3e2c2fbc0595814d85ede41c9ea9109e
---

# DCS-1b.09b — Wyścig hydratacji po logowaniu/MFA (React #418 na liście akcji profilu dokumentu)

## Cel
Nazwać mechanizmem i naprawić u źródła losowy błąd hydratacji React #418 na liście akcji profilu dokumentu, występujący przy zmianie stanu logowania — przed 1b.15 (import na prod, 30.09).

## Zakres
- [ ] Odczyt stanu bieżącego (dodane przy imporcie)
- [ ] Sprawdzić, czy kliencki wrapper aplikacji odświeża router na zdarzeniach auth (`SIGNED_IN`/`TOKEN_REFRESHED`/`INITIAL_SESSION` → `router.refresh()`)
- [ ] Zalogować zdarzenia auth i moment `router.refresh()` obok błędnych ładowań; zobaczyć, czy korelują
- [ ] Poprawka u źródła (jeśli hipoteza się potwierdzi)

## Gotowe, gdy
Wszystko na lokalnym buildzie produkcyjnym (`next build` + `next start`):
- **Mechanizm nazwany** — **jak sprawdzić**: łańcuch przyczynowy w raporcie rundy 1, poparty deterministycznym odtworzeniem (≥ 9/10 ładowań z ustawieniem) i logami zdarzeń ze znacznikami czasu dla ładowań błędnych i poprawnych. *(Zmienione z „TODO”: pierwotnej hipotezy nie ma w kodzie, więc sprawdzianem jest odtworzenie, nie hipoteza.)*
- **Poprawka u źródła** — **jak sprawdzić**: diff usuwa przyczynę nazwaną w kryterium 1; nie wycisza błędu (bez `suppressHydrationWarning`, bez filtrowania recoverable errors ani konsoli), nie przebudowuje panelu, a tj zaakceptował mechanizm przed poprawką. *(Zmienione z „TODO”.)*
- **`e2e:profile` ≥ 10 zielonych z rzędu, w dwóch osobnych seriach** — **jak sprawdzić**: logi obu serii (komenda + linie podsumowania) w raporcie.
- **Czerwony dowód** — **jak sprawdzić**: z ustawieniem odtworzenia z kryterium 1, poprawka cofnięta: #418 na ≥ 27 z 30 ładowań po logowaniu/MFA; poprawka założona: 0 z 30. *(Zmienione z „cofnięta poprawka → #418 na N ≥ 30 ładowań”: przy ~1/80 na main 30 zwykłych ładowań może nie dać żadnego błędu nawet bez poprawki, co niczego nie dowodzi.)*

## Poza zakresem
Przebudowa panelu „na ślepo” (patrz Bramki STOP).

## Bramki STOP
- Jeśli hipoteza upada — raport z nowym tropem, bez przebudowy panelu na ślepo.

## Kontekst
Znalezione przy 1b.09 (PR #81). Na buildzie produkcyjnym `e2e:profile` pada losowo na ostatnim kroku („no console or hydration errors”) — React #418 na profilu dokumentu. Na gałęzi #81 co 3.–10. przebieg, na `main` ~1 na 80. PR #81 zmergowany świadomie z tym błędem (kryterium 5b niespełnione, opis w `deferred-tasks.md` (ccc)).

### Co ustalono (diagnoza agenta, 21.09)
- `componentStack` z `onRecoverableError`, 3 błędne ładowania na 32 przebiegi, wszystkie identyczne: rozjechany węzeł to lista akcji `aside[aria-label="Current revision"] > section > ul`. Między nią a routerem **nie ma komponentu klienckiego ani węzła tekstowego**. Build dev: `+ <ul className="grid gap-3 …">` wobec `- <li className="space-y-1">` — różnica na poziomie elementu.
- Wszystkie błędne ładowania przy **zmianie stanu logowania**: pierwsze ładowanie po loginie (aal1) ×2, ładowanie tuż po `/mfa` (aal2) ×1.
- Audyt czasu/strefy czysty: brak `toLocale*`, `Intl`, `Date.now()`/`new Date()` na ścieżce renderu.
- Częstość rośnie z pracą hydratacyjną w panelu; Suspense pogarszał (19/120); usunięcie nowych komponentów nie usuwało (8/60).

### Hipoteza (nie ustalenie)
Kliencki wrapper aplikacji (w stosie) nasłuchuje zdarzeń Supabase Auth i przy `SIGNED_IN`/`TOKEN_REFRESHED`/`INITIAL_SESSION` woła `router.refresh()`. Tuż po logowaniu/MFA takie odświeżenie wpada w trakcie hydratacji z sesją w innym stanie (aal, rola) niż render HTML → drzewo akcji zależne od uprawnień różni się między HTML a danymi RSC.

### Termin
Przed 1b.15 (import na prod, 30.09), od kiedy na prodzie pojawią się pierwsi użytkownicy DCS.

## Notatki z realizacji
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3e2c2fbc0595814d85ede41c9ea9109e).
- 2026-09-22 tj: hipoteza z nasłuchem auth nieaktualna — na main brak onAuthStateChange w apps/ i packages/ (odczyt). Zadanie w dwóch rundach na jednej gałęzi: runda 1 diagnoza + deterministyczne odtworzenie, STOP; runda 2 poprawka po akceptacji tj. Czerwony dowód: deterministyczne odtworzenie zamiast liczby ładowań (przy ~1/80 na main N=30 bez poprawki może dać 0).
- 2026-09-22 tj: runda 1 przyjęta — mechanizm (błąd replay hydratacji w React, naprawiony upstream w react#35494) udowodniony odtworzeniem: czysty build 20/20 błędnych, z poprawką upstream 0/20.
- 2026-09-22 tj, decyzja 1: poprawka = opcja A — Next w `apps/dcs` podbity do 16.2.12 (razem z `eslint-config-next`); Timesheet zostaje na 16.1.1.
- 2026-09-22 tj, decyzja 2: odtworzenie zostaje w repo jako skrypt e2e poza CI.
