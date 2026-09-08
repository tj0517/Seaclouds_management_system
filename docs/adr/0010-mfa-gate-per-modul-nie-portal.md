# ADR-0010 — Gate MFA (aal2) zostaje w obu aplikacjach, nie na poziomie portalu

## Kontekst

Zadanie 1a.23 wprowadza wspólny cookie sesyjny na `.seaclouds.eu` (TES:
`app.seaclouds.eu`, DCS: `dcs.seaclouds.eu`, wspólny projekt Supabase), żeby
kliknięcie kafelka modułu nie wymagało ponownego logowania. `dcs.dictionaries`
ma politykę RLS czytającą `auth.jwt()->>'aal'` (migracja
`20260904160000_dictionaries_dc_aal2.sql`), więc stan aal2 (TOTP) też musi
przetrwać skok między modułami — inaczej DC/admin przechodzący z TES do DCS
dostałby aal1 i RLS by go zablokowało mimo że przeszedł 2FA chwilę wcześniej.

Dziś obie aplikacje mają identyczny, niezależny gate: `proxy.ts` przekierowuje
sesję `aal1` na `/mfa`, gdy trasa zaczyna się od `/admin` i profil to
administrator lub DC (`dcs.project_roles`). Dwa prawie identyczne ekrany
`/mfa` (enroll + challenge TOTP) żyją osobno w `apps/timesheet/app/mfa/` i
`apps/dcs/app/mfa/`.

Do rozstrzygnięcia: czy 1a.23 powinno scalić to w jeden ekran `/mfa` na
poziomie portalu, czy zostawić dwa istniejące.

## Kluczowy fakt

`aal` to claim w JWT sesji (`getAuthenticatorAssuranceLevel()` w
`@supabase/ssr` dekoduje go lokalnie z access tokenu, bez wywołania
sieciowego), liczony przez GoTrue z `auth.mfa_amr_claims` przypisanych do
danej sesji — nie osobny stan per aplikacja. Access token przeżywa refresh
z tym samym `aal`, dopóki sesja (i jej `amr`) się nie zmieni. Skoro 1a.23
każe TES i DCS dzielić jeden cookie sesyjny (ten sam `sb-<ref>-auth-token`,
`domain=.seaclouds.eu`), to ta sama sesja — i jej `aal` — automatycznie
trafia do drugiej aplikacji. Weryfikacja TOTP w jednej aplikacji **już**
podnosi `aal` widoczny w drugiej, zanim cokolwiek w tym zadaniu dotknie
ekranu MFA.

## Decyzja

Zostają dwa istniejące, per-aplikacyjne ekrany `/mfa` (`apps/timesheet/app/mfa`,
`apps/dcs/app/mfa`) i dwa niezależne gate'y w `proxy.ts`. Zmiana cookie
(ten task) to jedyna zmiana potrzebna, żeby "przejdź 2FA raz, działa
wszędzie" — gate w aplikacji, do której użytkownik trafia jako drugiej,
po prostu widzi `aal2` z sesji odziedziczonej po pierwszej i nie
przekierowuje na `/mfa` w ogóle.

## Odrzucona opcja: jeden `/mfa` na poziomie portalu

Odrzucone. Koszt bez korzyści:

- **Nie rozwiązuje niczego, czego nie rozwiązuje już współdzielony cookie.**
  aal2 i tak przechodzi między aplikacjami przez sesję — portalowy ekran
  MFA nie dodaje żadnej nowej zdolności, tylko przenosi istniejącą logikę
  w trzecie miejsce.
- **Poszerza obowiązek 2FA na złych warunkach.** Portal (`/` w
  `apps/timesheet`) jest wspólnym punktem wejścia dla wszystkich, nie tylko
  admina/DC. Gate na poziomie portalu musiałby albo wymuszać TOTP na każdym
  zwykłym pracowniku wchodzącym po prostu zalogować godziny (regresja
  względem dzisiejszego stanu — `proxy.ts` gate'uje wyłącznie `/admin`),
  albo powielać dokładnie tę samą logikę "czy to admin/DC" co dziś żyje w
  `proxy.ts` obu aplikacji — bez usunięcia oryginału, bo `dcs.dictionaries`
  i tak wymusza aal2 na poziomie RLS niezależnie od tego, co zrobi portal.
- **Dodaje międzydomenowy `next` redirect do utrzymania.** Dzisiejszy `/mfa`
  wraca pod `?next=<ścieżka w tej samej aplikacji>`. Portalowy ekran MFA
  żyjący w `apps/timesheet` musiałby umieć wrócić na trasę w `apps/dcs` —
  albo pełny URL w query param (nowa powierzchnia do zwalidowania — otwarty
  redirect, gdyby przyjąć dowolny host), albo osobny mechanizm przekazania
  "dokąd wracamy" między aplikacjami. Zadanie explicite wyklucza budowanie
  nowego mechanizmu transferu sesji/stanu między aplikacjami.
- **Dwa prawie identyczne ekrany to dług do posprzątania kiedyś, nie problem
  do rozwiązania teraz.** Realne zduplikowanie to `resolveMfaFactorState()` +
  layout enroll/challenge — oba już wydzielone do `lib/mfa-factor-state.ts`
  per aplikacja. Współdzielenie tego pliku (np. jako kolejny leaf export
  `@scl/db`) jest tańsze niż migracja całego ekranu na portal i nie wymaga
  cross-app redirectu — ale to nie jest w zakresie 1a.23.

## Konsekwencje

- Żadna zmiana kodu w `/mfa` ani w gate'ach `/admin` obu `proxy.ts` — 1a.23
  dotyka tylko `cookieOptions` (domena cookie) w klientach Supabase.
- Weryfikacja: TOTP zweryfikowane w jednej aplikacji musi być widoczne jako
  `aal2` po stronie serwera drugiej aplikacji od razu po skoku, bez
  przechodzenia przez jej `/mfa` — to jest dowód, że decyzja tutaj jest
  poprawna, nie tylko tania.
- Jeśli w przyszłości portal zyska własne trasy wymagające aal2 (nie tylko
  kafelki), pytanie "gdzie żyje `/mfa`" wraca — ale to nowy kontekst, nowe
  ADR, nie nowelizacja tego.

## Data / Status

2026-09-06 (DCS 1a.23) / przyjęta
