# ADR-0011 — `hasModuleAccess` failuje otwarcie i loguje we własnym miejscu

## Kontekst

1a.23 pierwszy raz podłącza `public.module_permissions` do realnego
egzekwowania trasy, nie tylko widoczności kafelka — ADR-0009 świadomie to
odłożył ("konsumowanie z proxy.ts... to osobne zadanie"). `apps/dcs/proxy.ts`
woła teraz `hasModuleAccess()` (`packages/db/src/module-access.ts`), żeby
zdecydować, czy zalogowany użytkownik w ogóle wchodzi do aplikacji DCS.

Odczyt może zawieść na dwa różne sposoby, wymagające różnego traktowania:
wiersza po prostu nie ma (prawdziwa odpowiedź: brak dostępu) albo tabela jest
nieosiągalna (migracja jeszcze nie dotarła do środowiska, błąd sieci/bazy —
odpowiedź nieznana, nie "brak"). Ten ADR dotyczy drugiego przypadku.

## Decyzja

**Fail OPEN** (wpuść) przy błędzie odczytu, **logując z własnego miejsca
wywołania** — nie licząc na to, że zaloguje kod, który akurat woła tę
funkcję.

- **Dlaczego otwarcie, nie zamknięcie.** Cała aplikacja DCS to moduł "dcs" —
  błąd odczytu przy zamknięciu oznacza potencjalnie odmowę KAŻDEMU
  użytkownikowi DCS naraz: samo-zadana pełna awaria z powodu luki
  infrastrukturalnej, niezwiązanej z żadną realną decyzją o dostępie. To
  gorszy skutek niż wpuszczenie wszystkich na czas (rzadkiego, przejściowego
  albo wynikającego z opóźnienia migracji w danym środowisku) okna, w którym
  tabeli nie da się odczytać — ta sama logika co przy degradacji widoczności
  kafelków (zostaw bieżący moduł osiągalny).
- **Dlaczego log we własnym miejscu, nie u wywołującego.** Wcześniejsza
  wersja tego pliku świadomie pomijała `console.error` na tej ścieżce,
  rozumując tak: jedyny dziś wywołujący (`apps/dcs/proxy.ts`) zawsze
  przechodzi dalej do `apps/dcs/app/(app)/layout.tsx` w tym samym żądaniu,
  który niezależnie woła `fetchMyModules()` i loguje ten sam błąd odczytu —
  więc pominięcie logu tutaj unikało podwójnej linii dla jednego żądania. Ta
  logika nie przeszła review: uzależnia poprawność tej funkcji ("degraduj
  głośno") od zachowania INNEGO pliku, którego ta funkcja nie kontroluje i
  nie widzi — ukryte sprzężenie, niewidoczne przy czytaniu samej funkcji.
  "Zaloguj raz na żądanie" nie jest czymś, co jedna funkcja może obiecać w
  imieniu wywołującego, którego nie kontroluje; każdy odczyt, który może
  failować otwarcie, musi zgłosić to sam.

## Konsekwencje

- Zdegradowane żądanie do DCS (tabela nieosiągalna) drukuje dziś DWIE linie
  logu, nie jedną: jedną z `hasModuleAccess` (gate trasy), jedną z
  `fetchMyModules` (`apps/dcs/app/(app)/layout.tsx`, widoczność w sidebarze)
  — obie o tym samym leżącym u podstaw błędzie odczytu. To jest poprawny,
  oczekiwany kształt, nie błąd do wyeliminowania: "dokładnie jedna linia
  logu" (1a.23, punkt zakresu 4) dotyczyła konkretnie odczytu widoczności
  kafelków na portalu TES (`getMyModulePermissions`,
  `apps/timesheet/app/page.tsx`), który ma dokładnie jednego wywołującego i
  tam to zdanie zostaje prawdziwe — nigdy nie było to globalne "jedna linia
  na żądanie HTTP" liczone przez wszystkie niezależne odczyty degradujące
  się głośno, które akurat zdarzą się w tym samym żądaniu.
- **Warunek wygaśnięcia.** Fail-open jest tani tylko dlatego, że dziś "dcs"
  to JEDYNY moduł z gate'em trasy — okno nieosiągalności tabeli oznacza, że
  DCS wpuszcza wszystkich: jeden, ograniczony, znany promień rażenia. W dniu,
  w którym drugi moduł dostanie analogiczny gate (BMS w Fazie 2+, albo gdyby
  TES kiedyś taki gate zyskał — patrz komentarz przy kafelku TES na portalu,
  `apps/timesheet/app/page.tsx`, dlaczego dziś go nie ma), fail-open przestaje
  znaczyć "jeden moduł chwilowo bez gate'u", a zaczyna znaczyć "każdy
  moduł portalu z gate'em chwilowo bez gate'u naraz" — to jest inne ryzyko
  do zaakceptowania, nie to samo skopiowane domyślnie. Kto dodaje ten drugi
  gate, musi tę decyzję przemyśleć na nowo, nie skopiować — albo zostawić
  fail-open świadomie, albo przejść na fail-closed z prawdziwą stroną
  "przerwa techniczna" zamiast cichego przekierowania.

## Data / Status

2026-09-08 (DCS 1a.23) / przyjęta
