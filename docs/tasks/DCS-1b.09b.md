---
id: DCS-1b.09b
title: "Wyścig hydratacji po logowaniu/MFA (React #418 na liście akcji profilu dokumentu)"
status: todo
difficulty: L
model: null
model_approved: null
effort: null
branch: null
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
Na buildzie produkcyjnym:
- przyczyna nazwana mechanizmem — **jak sprawdzić**: TODO
- poprawka u źródła — **jak sprawdzić**: TODO
- `e2e:profile` ≥ 10 zielonych z rzędu na dwóch seriach — **jak sprawdzić**: przebiegi `e2e:profile`
- czerwony dowód — **jak sprawdzić**: cofnięta poprawka → #418 wraca na N ≥ 30 ładowań po logowaniu/MFA

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
