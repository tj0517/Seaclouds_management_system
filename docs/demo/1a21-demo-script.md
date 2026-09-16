# DCS 1a.21 — demo script for the 1a → 1b gate

Audience: the client's **Document Controller (DC)** and **MD**.
Presenter: repo owner, screen-sharing from their own machine.
Environment: **scl-dev** (`mzotiurydmhibqhxxzoh`) — never prod.
Terms used on screen follow `docs/00-glossary.md`: **MDR**, **DC**, **ORIG**,
**CHK**, **APP**, **REV**, **VIEW**, **IDC / IFR / RETCOM / IFC**.

Seven steps, ~20 minutes. Each step names the account, where you are, what to
click, what should happen, and one fallback line to say out loud if it does
not. After step 7 the DC repeats steps 3–5 unaided — hand them remote control
of the shared screen at that point.

---

## Before you start

| | |
|---|---|
| **URL** | **https://dcs-kqpda9tl4-tymon-jezionek.vercel.app** |
| **Backup URL** | none. If Preview is down, the demo does not move to prod. |
| **Vercel login** | Log in to Vercel **before** joining the call. Preview deployments on the `dcs` project sit behind Vercel Authentication (`ssoProtection = all_except_custom_domains`). Because you present by screen share, the client never sees that wall — but you must clear it first, in the same browser profile you will demo from. |
| **Accounts** | `dcs1a14-admin@example.com` (admin, TOTP enrolled) · `dcs1a14-dc@example.com` (DC, TOTP enrolled) · `dcs1a14-member@example.com` (plain employee, **no** TOTP) |
| **Passwords / TOTP secrets** | **Not in this repo.** `~/Desktop/seaclouds/backups/dcs1a14-test-accounts-scl-dev-2026-09-08.txt` (chmod 600). Have your authenticator app open before the call. |
| **Second browser** | Use a private/incognito window for step 7 so the admin session in step 1–6 stays live. |
| **Supabase dashboard** | Open the **scl-dev** project's SQL editor in another tab, with the step-6 query already pasted but not run. |

> **That URL is the immutable deployment of commit `87712ee`** (PR #54,
> `chore/dcs-1a21a-demo-prep`), built green on 2026-09-16. It is pinned to that
> commit, not to the branch — pushing more commits does not change where it
> points, and it will keep serving that exact build.
>
> Every commit after `87712ee` on this branch changes **documentation only**
> (this file included), so the app behind that URL is the app being
> demonstrated. **If a later commit touches anything under `apps/`,
> `packages/` or `supabase/`, this line is wrong** — take the new commit's
> deployment URL from `vercel` and replace it here before the demo.

**State this script assumes on scl-dev** (created during the 1a.21a data prep,
see `docs/deferred-tasks.md`):

- client **`DEMO` — Demo Client** exists and is active;
- project **SC2601 · OW_Fishing Support** exists, client `DEMO`, process type
  Project, cycle 7/10/7, **zero** `dcs.project_roles` rows;
- `dcs1a14-admin` holds **no** `rev` role on SC2602 (removed during prep, so
  step 7's contrast is clean);
- dictionaries are seeded (1a.18): 4 active **Area** entries, 23 active
  **Document Type** entries.

---

## Presenter smoke check — do this once, before the demo

**Performed by the presenter, not by the agent.** The dress rehearsal for this
script was run against a local production build of commit `87712ee` pointed at
scl-dev — same code, same database, different hostname. What that cannot prove
is that the **Preview deployment itself** is wired to scl-dev and serves this
build. Five minutes, any time before the call:

1. Open the pinned Preview URL above. Clear Vercel's own login wall if it
   appears — that is Vercel, not the app.
2. Log in as `dcs1a14-dc@example.com`, with its TOTP code. **Note the time.**
3. Confirm the sidebar reads **Projects · Dictionaries · Clients**. A DC gets
   all three; that is the 1a.21a change.
4. Confirm the project list shows a **Team** link on **SC2602** and **SC2699**
   and on no other row — this account is DC of those two only. In particular
   SC2601 must have no Team link, because this account holds no role on it.
5. Open **Clients**: it must render, and it must say *"Read-only — only an
   admin can add or edit clients here."* A DC reaches that screen and cannot
   edit it.
6. Sign out.

Then confirm the deployment really talks to scl-dev, which is the whole point
of the check — on the scl-dev SQL editor:

```sql
select email, last_sign_in_at
from auth.users
where email = 'dcs1a14-dc@example.com';
```

`last_sign_in_at` must match the time you noted in step 2. If it does not, the
Preview deployment is pointed somewhere else and **the demo does not go ahead
on that URL**.

---

## Step 1 — Admin logs in, with 2FA

**Account:** `dcs1a14-admin@example.com` · **Where:** the URL above

1. Open the URL. The DCS login page appears.
2. Enter the email and password, submit.
3. The app sends you to `/mfa`. Enter the 6-digit TOTP code from the
   authenticator app.

**Expected:** you land on the DCS project list. The sidebar reads **SCL DCS**,
your name, then **Projects · Dictionaries · Clients**, and **Sign out**.

**Say:** "Second factor is not optional for an admin or a Document Controller
— and it is not just the screen asking. The same requirement is written into
the database's own access rules, so it holds even for someone calling the API
directly."

**Fallback:** if the code is rejected, it is almost always clock drift — wait
for the next 30-second code and retry. Do not try a second account mid-step.

---

## Step 2 — Switch to DCS from the Timesheet module

**Account:** same session · **Where:** sidebar module switcher

1. In the sidebar, use the module switcher to go to Timesheet (TES) and back
   to DCS.

**Expected:** the switcher shows both modules because this account has both
grants in `public.module_permissions`.

> **Known, and say it plainly:** on this preview environment the two apps sit
> on different hostnames, so the session cookie cannot be shared and DCS will
> ask for the password again. On production the two modules live on
> `app.seaclouds.eu` and `dcs.seaclouds.eu` — one parent domain, one cookie,
> and the switch is seamless, second factor included. This is a property of
> the preview URL, not of the product.

**Say:** "One account, one login, two modules. What a person can open is a
per-user grant, not a job title — an employee who only books hours never sees
DCS at all."

**Fallback:** if re-login is slow, skip the round trip and just point at the
switcher in the sidebar; the grant is what matters, not the trip.

---

## Step 3 — Grant DCS roles on SC2601

**Account:** admin · **Where:** project list → SC2601

1. On the project list, find the row **SC2601 · OW_Fishing Support**. The
   Cycle column shows `7/10/7`, Team shows `0`.
2. Click **Team** in that row. (The link only appears for someone who may
   change that project's team — an admin, or that project's own DC.)
3. On the project page, use **Add a member…** to pick
   `DCS1a14 Test DC-of-PEJ`, tick **Document Controller**, click **Add**.
4. Repeat for `DCS1a14 Test Member-of-PEJ` → tick **Originator**.
5. Repeat for `DCS1a14 Test Admin` → tick **Checker** and **Approver**.

**Expected:** the team table grows to three rows. Each row has the six role
checkboxes with a **Save** button; the ticks you made are already saved.

**Say:** "Six roles, and they are per project, not per person — the same
engineer can be Originator on one project and Checker on another. **ORIG**
owns the document, **CHK** and **APP** sign it off, **REV** comments during
IDC, **VIEW** reads, and the **DC** is the only role that issues numbers and
closes the cycle."

**Fallback:** if a Save shows an error, reload the page once — the ticks that
did save are already in the table. If it persists, move to SC2699, which
already carries a full team, and show the same screen there.

---

## Step 4 — Create a project in the Create Project MDR wizard

**Account:** admin · **Where:** project list → **New project MDR**

Six steps, one at a time, one write at the end.

| Wizard step | What to enter |
|---|---|
| 1 · Identification | Project code **`SC2698`**, Name `OW_Export Cable Survey`, Process type **Project**, Year `2026` |
| 2 · Client | **DEMO — Demo Client** |
| 3 · Review cycle | leave the defaults **7 / 10 / 7** |
| 4 · Team and roles | add `DCS1a14 Test DC-of-PEJ` → **Document Controller** |
| 5 · CTR codes | `SC2698_CTR100` "Project management", `SC2698_CTR200` "Survey and reporting" |
| 6 · Budget | `1200` |

Then submit. The app sends you to the new project's page.

**Expected:** the new project's MDR summary shows client `DEMO`, cycle 7/10/7,
budget 1200 h, status Active, and a one-person team.

**Say:** "That is the **MDR** — the Master Document Register settings the
whole project inherits. The 7/10/7 cycle is IDC → IFR seven days, IFR →
RETCOM ten, RETCOM → IFC seven: twenty-four days, and every document created
here starts from that. The **CTR** codes are the same cost codes the
timesheet books hours against, so documents and hours land on one structure."

**Say about the code:** "The project code is the first segment of every
document number in the project — `SC2601-SCL-RA-0012-EN`. Once the project
exists, that code cannot be edited; the database refuses it."

**Fallback:** if `SC2698` is rejected as already taken, use the reserve code
**`SC2697`** (and `SC2697_CTR100` / `SC2697_CTR200`) and carry on; nothing
later in the script depends on which code it was. `SC2690` is *not* a reserve
— it is the rehearsal's throwaway project and already exists.

---

## Step 5 — Edit a dictionary

**Account:** admin · **Where:** sidebar → **Dictionaries**

1. Open the **Document Type** tab. Click **Add Document Type**.
   - Code `MOM`, Label `Minutes of Meeting`, Sort order `240` (after the 23
     seeded entries).
   - Save. The new row appears at the bottom with an **Active** badge.
2. Open the **Area** tab. The four seeded areas are `00 General`,
   `10 Offshore`, `20 Nearshore`, `30 Onshore`. On the **`30 · Onshore`** row,
   click **Deactivate**.
   - The row dims and its badge changes to **Inactive**.
   - Note the button now reads **Reactivate** — nothing was deleted.

**Expected:** both changes appear immediately, without a page reload.

**Say:** "These are the company-wide code lists every project draws on:
document types, disciplines, areas, languages, the 1–4 acceptance codes.
Nothing here is ever deleted — an entry is deactivated, so it stops being
offered on new documents while every document that already used it keeps its
meaning. The same is true of clients and of document numbers: a number that
is voided never returns to the pool."

**Fallback:** if `MOM` already exists (someone rehearsed with it), use `MOM2`
and carry on. If `30 · Onshore` is already inactive, deactivate
`20 · Nearshore` instead; either makes the point.

---

## Step 6 — Show the audit trail

**Account:** admin · **Where:** Supabase dashboard → scl-dev → SQL editor

This step deliberately has no screen in the app. Run the query below and read
the result on screen.

```sql
-- DCS 1a.21 demo, step 6: everything the last few minutes changed, and who
-- changed it. Adjust the window on the first line to today's demo.
select
  coalesce(p.full_name, a.user_id::text) as actor,
  a.occurred_at,
  a.table_name,
  a.action,
  a.field_name,
  a.old_value,
  a.new_value
from public.audit_log a
left join public.profiles p on p.id = a.user_id
where a.occurred_at >= timestamptz '2026-09-16 00:00:00+00'   -- ← demo window
  and a.table_name in (
    'public.projects',
    'public.clients',
    'dcs.project_roles',
    'dcs.mdr_settings',
    'dcs.dictionaries'
  )
order by a.occurred_at desc, a.table_name, a.field_name;
```

**Expected rows, newest first:** the `dcs.dictionaries` INSERT and UPDATE from
step 5, the `public.projects` / `dcs.mdr_settings` / `dcs.project_roles`
inserts from step 4 (all sharing one timestamp — one transaction), and the
`dcs.project_roles` inserts from step 3. The **actor** column reads
`DCS1a14 Test Admin` throughout.

**Say:** "Every change is recorded field by field — old value, new value, who,
and when — by the database itself, not by the application. An action taken
outside the app is recorded exactly the same way. On production this log is
evidence towards you as the client, so nothing deletes from it."

**Fallback:** if the result is empty, the window on the first line is wrong —
widen it to `now() - interval '2 hours'` and rerun.

---

## Step 7 — The same system as a regular employee

**Account:** `dcs1a14-member@example.com` · **Where:** a private/incognito
window on the same URL

1. Log in. **No second-factor prompt appears** — this account is not an admin
   and not a DC, so the 2FA gate does not apply to it.
2. The project list shows only the projects this person holds a DCS role on —
   including SC2601, where step 3 just made them Originator.
3. The sidebar shows **Projects** only: no **Dictionaries**, no **Clients**.
4. There is no **New project MDR** button, and no **Team** link on any row.
5. Type `/admin/dictionaries` into the address bar → you are sent back to the
   project list. Same for `/admin/clients`.

**Expected:** everything above, in that order.

**Say:** "Same system, same data, one account — and this is what a regular
engineer sees. The screens they are not offered are also closed if they type
the address directly, and underneath both of those the database applies the
same rules to anything that talks to it at all."

**Honest caveat, if asked:** this person can still open a project's team page
from the project list and *read* the team of a project they belong to — that
is deliberate, a project member may see who their reviewers are. They cannot
change anything on it: no Add, no Save.

**Fallback:** if the account shows an empty project list, step 3 did not save
— log back in as admin, re-add the Originator role on SC2601, and retry.

---

## Then hand over

Give the DC remote control of the shared screen and ask them to repeat
**steps 3, 4 and 5** on their own, as `dcs1a14-dc@example.com` (password and
TOTP in the backups file above). Expect two differences, and they are the
point:

- a DC gets **Dictionaries** and **Clients** in the sidebar, and can change
  dictionaries — but the Clients screen is read-only for them, because clients
  drive CPY numbering and only an admin edits that list;
- a DC sees a **Team** link only on their own projects, and **New project MDR**
  not at all — a project is created by an admin, and a DC is assigned to it
  once it exists.

## After the demo

Leave every row created during the demo on scl-dev. It is the evidence for
this gate, and later tasks read it. Do not tidy up, and never delete from
`public.audit_log`.
