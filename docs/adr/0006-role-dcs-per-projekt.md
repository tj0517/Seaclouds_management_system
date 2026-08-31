# ADR-0006 — Role DCS wyłącznie per projekt w `dcs.project_members`

## Kontekst

Brief (§3) definiuje role DCS przypisywane per projekt: Originator,
Reviewer, Checker, Approver, Document Controller, Viewer. TES ma globalny
enum `public.user_role` (`admin | employee | project_lead`) w
`public.profiles.role`. Punkt otwarty O-12: czy DC i ADM dodać jako nowe
wartości `user_role`, czy trzymać role DCS wyłącznie per projekt — i jak
`project_lead` z TES ma się do ról DCS.

## Decyzja

- `public.profiles.role` (`user_role`) zostaje globalny i należy do TES —
  NIE dodajemy do niego wartości DC ani ADM.
- Role DCS istnieją wyłącznie per projekt, w
  `dcs.project_members.dcs_role (orig|rev|chk|app|dc|viewer)`.
- `project_lead` z TES nie ma odpowiednika w DCS i nie jest mapowany —
  dostęp do DCS wynika wyłącznie z wpisu w `dcs.project_members`.
- Administrator DCS = `profiles.role = 'admin'` (globalny admin portalu).

## Konsekwencje

- Migracje DCS nie dotykają enuma `user_role` ani tabeli `profiles`.
- Polityki RLS `dcs.*` opierają się na `dcs.project_members`
  (+ `is_admin()` dla admina); ta sama osoba może mieć różne role
  w różnych projektach.
- Lead TES bez wpisu w `dcs.project_members` nie widzi danych DCS swojego
  projektu — zamierzone; rola DC nie daje żadnych uprawnień w TES.
- Wymóg 2FA (O-14) dotyczy operacji wykonywanych jako DC/admin, więc
  wymuszenie aal2 musi patrzeć na `dcs_role` i `is_admin()`, nie na nowe
  wartości globalnego enuma.

## Data / Status

2026-08-31 (rozstrzygnięcie O-12) / przyjęta
