# ADR-0015 — Numeracja rewizji SCL: serie liczone per format, RETCOM bez serii, bypass sesji bez użytkownika

**Status:** przyjęte.
**Data:** 2026-09-20. **Decyzje:** właściciel (tj), przy zadaniu DCS 1b.08.
**Zakres:** tylko kolumna `dcs.revisions.scl_revision` i jej generator. To **nie**
jest ADR wsteczny dla generatora numeru dokumentu (1b.02) — ten nadal nie ma
własnego ADR-u, a jego decyzje żyją w komentarzach migracji
`20260918085125_scl_doc_number_generator` i w jej teście.

## Kontekst

`dcs.revisions.scl_revision` jest `NOT NULL` i `UNIQUE (document_id,
scl_revision)`. Od 1b.01 do 1b.08 **nic nie decydowało o jego wartości**: przechodził
dowolny tekst, a każdy INSERT musiał go podać sam (`docs/deferred-tasks.md` (pp)).
`CLAUDE.md` wymaga, żeby ręczny wpis numeru SCL był niemożliwy w każdym formularzu
i akcji. 1b.08 (okno New Revision) jest miejscem, w którym wybierany jest krok, a
więc i seria — więc tu powstaje generator, w kształcie z 1b.02: funkcja liczy,
trigger `BEFORE INSERT` wypełnia `NULL` i odrzuca wartość podaną ręcznie.

Trzy reguły domenowe nie wynikały z kodu ani z briefu wprost i wymagały decyzji.

## Decyzja 1 — licznik serii jest liczony per format serii, nie per krok

Serie (brief §6.5): `IDC` → `A, B, C…`; `IFR` → `00, 01…`; **`IFC` / `IFI` / `IFB`
→ `1, 2, 3…` jeden wspólny licznik na trzy kroki.**

**Dlaczego.** Brief §6.5 opisuje trzy rewizje finalne jako jedną serię („1 pierwsze
wydanie, 2 ponowne”). Licznik per krok dałby IFC `1`, a potem IFI `1` na tym samym
dokumencie — i `UNIQUE (document_id, scl_revision)` odrzuciłby drugi INSERT.
Licznik czyta więc **krok i wartość**: najwyższy kod użyty przez kroki tej serii na
tym dokumencie, plus jeden. Sama wartość nie wystarcza — finalne „10” i IFR „10”
wyglądają tak samo, a należą do różnych serii. Wartość w formacie niepasującym do
serii (np. z importu) niczego nie liczy; siatką bezpieczeństwa jest `UNIQUE` — zły
przypadek to głośne `23505`, nigdy cichy duplikat.

## Decyzja 2 — `RETCOM` nie ma serii w Fazie 1 (celowo, nie przeoczenie)

`dcs.next_revision_code` rzuca nazwany błąd dla `RETCOM`, a trigger odrzuca INSERT
z krokiem `RETCOM` (`23514`), także gdy `scl_revision` podano ręcznie. Wyjątek: sesja
z `dcs.import_mode = 'on'` — historyczne wiersze RETCOM niesie import SMDR (1b.13).

**Dlaczego — to jest ta część, którą łatwo wziąć za przeoczenie.** `RETCOM` to klient
zwracający dokument, a nie SCL wydający rewizję. W arkuszu niesie **ten sam numer, co
rewizja IFR, którą zwraca**; `UNIQUE (document_id, scl_revision)` nie potrafi czegoś
takiego utrzymać. Faza 1 nie ma silnika obiegu, z którego dałoby się wyprowadzić
lepszy numer. Zamiast zgadywać, system odmawia i mówi dlaczego — komunikat błędu
i komentarz migracji powtarzają, że to decyzja.

**Rozważone i odrzucone:**
- *Ciągnąć serię IFR dalej dla RETCOM* — wygenerowałoby numer, który nie odpowiada
  niczemu w arkuszu, a przy IFR `00` → RETCOM `01` → następny IFR `02` rozjechałoby
  numerację ze stanem faktycznym.
- *Zmienić `UNIQUE` tak, żeby obejmował krok* — zmienia, co znaczy numer rewizji dla
  wszystkich odczytów. **Nie analizowane** w 1b.08; jeśli wróci, to jako decyzja Fazy 2
  razem z maszyną stanów.

**Otwarte, świadomie:** import RETCOM musi przynieść kod, który `UNIQUE` przyjmie —
czyli nie numer IFR, który wiersz zwraca. Konwencję wybiera 1b.13 (`docs/deferred-tasks.md` (yy)).

## Decyzja 3 — kto może podać kod ręcznie; bypass sesji bez użytkownika (`auth.uid() IS NULL`)

`NULL` → kod z generatora, dla każdego. Kod **podany** przez zalogowanego
użytkownika przyjmuje trigger `revisions_assign_scl_revision` tylko od **DC tego
projektu w sesji aal2** — i sprawdza go wtedy z kształtem serii kroku (`^[A-Z]$` dla
IDC, `^[0-9]{2}$` dla IFR, `^[1-9][0-9]{0,5}$` dla IFC/IFI/IFB; jedno miejsce:
`dcs.revision_series_pattern`). Każdy inny zalogowany użytkownik, także ORIG, dostaje
`42501` (te same dwa sformułowania co `enforce_dc_only_numbering`: nie-DC / brak
drugiego składnika). Wybór kodu w serii należy do DC (poza kolejnością, z pominięciem
numeru); zderzenie z istniejącym łapie `UNIQUE`. Poza tym trigger przepuszcza podany
kod **bez sprawdzania kształtu**, gdy nie ma użytkownika w sesji (migracja, `seed.sql`,
psql, `service_role`) albo gdy `dcs.import_mode = 'on'`.

*Historia, żeby nie powtórzyć błędu:* pierwsza wersja migracji odrzucała podany kod
także DC (`23001`, wzorzec numeru dokumentu), wbrew zadaniu (kryterium 2: DC w aal2
może podać kod) i wbrew jego kodowi błędu (`insufficient_privilege`). Wyłapane przy
czytaniu treści zadania przed budową UI; poprawione w tej samej, jeszcze niewypchniętej,
migracji.

**Konflikt precedensów, który tu rozstrzygamy dla rewizji, a nie dla całej bazy.**
Dwa istniejące wzorce mówią co innego:
- `public.assign_scl_doc_number()` (1b.02, decyzja 3 w komentarzu migracji) **celowo
  nie ma** bypassu `auth.uid() IS NULL` — numer dokumentu jest faktem o numerze,
  a jedyną furtką jest GUC `dcs.import_mode`; rozstrzygnięcie, czy import może
  działać z sesji zalogowanego DC, zostawiono 1b.12–1b.15.
- `public.enforce_dc_only_numbering()` (1b.01/1b.03) **ma** ten bypass — to reguła
  *autoryzacyjna* („który z zalogowanych użytkowników może"), a wywołujący bez sesji
  nie ma wiersza w `dcs.project_roles` i i tak omija RLS na tej tabeli.

Rewizje idą za drugim wzorcem. **Dlaczego:** `scl_revision`, w odróżnieniu od
`scl_doc_number`, nie ma triggera niezmienności — DC w aal2 może go zmienić po
INSERT (1b.01) i, wg zadania, podać przy INSERT — więc nie jest „faktem o numerze" w
tym samym twardym sensie; a bez bypassu postgres nie mógłby naprawić wiersza ani
załadować fixture'a. Jedenaście
istniejących INSERT-ów w testach i fixture 1b.07 pisze bez sesji i pozostaje bez zmian.

**Konsekwencje, które trzeba mieć na piśmie:**
- **Kształt serii sprawdza tylko ścieżka DC.** Import i sesja bez użytkownika go
  pomijają (import odpowiada za format tego, co niesie; kto i tak może pisać do tabeli
  wprost, nie zyskuje na kontroli, którą też może obejść). `UPDATE` (1b.01) też go nie
  sprawdza.
- **`service_role` wpada w ten bypass.** Trasa serwerowa zapisująca `dcs.revisions`
  kluczem serwisowym może ustawić `scl_revision` dowolnie. Sprawdzone 2026-09-20:
  żadna taka trasa nie istnieje (jedyne moduły z kluczem serwisowym to klient admina
  Timesheeta i eksport MDR, żaden nie pisze do `dcs.revisions`). Gdy taka trasa
  powstanie, to decyzja podejmowana świadomie, nie domyślna.
- **Dwa generatory są niespójne i to jest zapisane, nie naprawione:** numer dokumentu
  nie da się podać bez `import_mode` nawet jako postgres, kod rewizji da się. Ujednolicenie
  oznaczałoby albo usunięcie bypassu tutaj (fixture'y i naprawy zaczęłyby wymagać
  `import_mode`), albo dodanie go do numeru dokumentu (decyzja 1b.02 mówi, że to nie
  ta zmiana). Nie jest to zadaniem 1b.08.

## Konsekwencje

- Migracje: `20260920134648_workflow_status_superseded`,
  `20260920134700_scl_revision_generator`, `20260920134800_revisions_promote_current`.
  Opis mechanizmu — `docs/02-data-model.md`, „Numeracja rewizji i bieżąca rewizja”.
- Testy: `supabase/tests/scl_revision_generator.test.sql`,
  `revision_promotion.test.sql`; dowody, których pgTAP nie da (wyścigi, zepsucie każdej
  kontroli po kolei): `scripts/revision-proofs.py`.
- Nadal otwarte, zapisane w `docs/deferred-tasks.md` (yy): DC w aal2 może zmienić
  `scl_revision` po INSERT; konwencja importu RETCOM; brak blokady na status
  `SUPERSEDED` nadany dokumentowi.
- **Zmiana którejkolwiek z trzech decyzji wymaga nowej migracji i nowego ADR-u**
  (nie edycji tego pliku); w szczególności odblokowanie RETCOM zmienia znaczenie
  numeru rewizji dla `v_mdr` i nazw plików (1b.09).

## Powiązane

1b.01 (`scl_revision` `NOT NULL` + `UNIQUE`), 1b.02 (generator numeru dokumentu),
1b.03 (`enforce_dc_only_numbering` na INSERT), 1b.08, 1b.13 (import),
`docs/deferred-tasks.md` (pp), (qq), (yy); brief §6.5.
