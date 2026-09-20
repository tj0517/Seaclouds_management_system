# ADR-0014 — Portal jako osobna aplikacja z adminem core i jedną stroną `/mfa`

**Status:** proposed / deferred — do rozstrzygnięcia przy Fazie 4 lub 5, nie do
realizacji w Fazie 1.
**Data:** 2026-09-20. **Autor pomysłu:** tj.

## Kontekst

Rzeczy współdzielone przez moduły (core) są administrowane w trzech miejscach:

- **Timesheet** (`apps/timesheet`, `admin/users/[id]`) — użytkownicy i globalna
  rola `profiles.role`, uprawnienia modułowe TES/DCS/BMS
  (`public.module_permissions`, 1a.22), klienci (1a.16), projekty (1a.17), 2FA.
- **DCS** (`apps/dcs`, `/admin/*`) — słowniki, role projektowe
  (`dcs.project_roles`, 1a.14), macierz użytkownik × projekt.
- **Portal** (1a.23) — mieszka na `/` w Timesheecie, tylko kafelki modułów;
  jedyny powód: nie było osobnej aplikacji.

Skutek: nadanie komuś dostępu do DCS wymaga wejścia do Timesheeta (przypadek
z 20.09: DC dodany w DCS lądował po logowaniu w TES, bo `module_permissions` miał
tylko `tes`). Strona `/mfa` jest zduplikowana per aplikacja — poprawka 1a.25
w DCS nie objęła TES i ten sam błąd wyszedł na Preview TES 20.09 (zadanie
1a.25b).

## Propozycja

Portal staje się czwartą aplikacją `apps/portal` z własnym hostem (np.
`portal.seaclouds.eu`) i przejmuje admin core: users + globalna rola, module
access, clients, projects, 2FA/enrolment, **jedna strona `/mfa`** (TES i DCS
przekierowują do niej), kafelki modułów jak dziś. TES i DCS zostają z adminem
tylko dla swoich rzeczy (TES: stawki, zamykanie tygodni; DCS: słowniki, role
projektowe). SSO bez zmian — ciastko sesji jest już na `.seaclouds.eu` (1a.23).

## Koszt i ryzyko

Kolejny projekt na Vercelu, `NEXT_PUBLIC_PORTAL_URL` w `turbo.json`, redirect URL
w `config.toml`. Przeniesienie kilku ekranów z Timesheeta, rząd kilkunastu
godzin. Dotyka logowania produkcyjnych adminów → wdrożenie dwutaktem (jak 1a.11):
najpierw równolegle, potem wyłączenie starych ekranów. Home TES wraca z `/tes` na
`/` albo zostaje — do decyzji.

## Alternatywy

1. Zostawić jak jest, dodać w DCS link „Module access" do ekranu w TES (~1 h, nie
   rozwiązuje duplikacji `/mfa`).
2. Sekcja Admin w obecnym portalu wewnątrz Timesheeta — taniej, ale utrwala
   Timesheet jako aplikację-matkę.

## Relacja do ADR-0010 (dopisane przy przenoszeniu — nie od autora pomysłu)

[ADR-0010](0010-mfa-gate-per-modul-nie-portal.md) odrzucił „jeden `/mfa` na
poziomie portalu" — dla zakresu 1a.23 i z zastrzeżeniem, że gdy portal zyska własne
trasy wymagające aal2 „pytanie wraca — ale to nowy kontekst, nowe ADR, nie
nowelizacja". Ten dokument jest takim nowym ADR-em, nie zmienia 0010. Jedno z jego
odrzucających uzasadnień nie jest w „Koszt i ryzyko" wyżej, a dotyczy tej
propozycji wprost: `/mfa` na innym hoście niż aplikacja docelowa musiałby wracać
międzydomenowo, czyli `next` przestaje być ścieżką w tej samej aplikacji, a staje
się pełnym URL-em — nowa powierzchnia otwartego przekierowania. Dzisiejsze
`safeNextPath` (1a.26) przepuszcza wyłącznie ścieżki względne, więc pod tę
propozycję musiałoby dostać inną regułę (np. listę dozwolonych hostów) albo
zostać zastąpione innym mechanizmem powrotu. Uwzględnić przy rozstrzyganiu.

## Powiązane

1a.13, 1a.22 ([ADR-0009](0009-module-permissions-per-uzytkownik.md)), 1a.23
([ADR-0010](0010-mfa-gate-per-modul-nie-portal.md),
[ADR-0011](0011-module-access-fail-open-log-w-miejscu-odczytu.md)), 1a.25,
1a.26 (`docs/deferred-tasks.md` (nn)), 1a.25b (`docs/deferred-tasks.md` (ww)).

## Data / Status

2026-09-20 (DCS 1a.25b) / proposed / deferred — do rozstrzygnięcia przy Fazie 4
lub 5, nie do realizacji w Fazie 1
