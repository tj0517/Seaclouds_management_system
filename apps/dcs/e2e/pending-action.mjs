// DCS 1b.07b — browser proof that a save through `hooks/use-pending-action.ts`
// actually finishes, on every screen that uses the hook. Run by hand against the
// LOCAL stack, on a PRODUCTION build. Not part of CI (docs/03-conventions.md,
// "Testy przeglądarkowe").
//
// WHY THIS SCRIPT EXISTS. `e2e:profile` passed on `next dev` while the same save
// hung on "Saving…" on a production build (DCS 1b.07 → 1b.07b), and 1a.25b → 1a.25c
// was the same story on Timesheet. The cause turned out to be a lost transition
// ping in Next 16.1.1 / React when a Server Action revalidates under a segment
// `loading.tsx` (docs/deferred-tasks.md, "1b.07b"). It hangs only SOMETIMES — about
// 40% of saves on the profile page — so:
//   * one green run proves nothing. Every screen below is exercised REPEATEDLY and
//     the script prints raw counts, never a ratio;
//   * "the spinner went away" is not the assertion. A save counts as done only when
//     the REFRESHED TREE has been committed to the page — something the server
//     renders (a row, a name, an option, a remounted input) is visible — AND the
//     pending indicator is gone. In every hang measured, the tree was never
//     committed; the spinner assertion alone would also have passed when the hook
//     stopped waiting for the refresh.
//
// Prerequisites (all local; docs/03-conventions.md, "Fixtury lokalne i testy
// przeglądarkowe"):
//   1. `supabase start` + `supabase db reset`, then the fixture
//      (supabase/fixtures/document_profile.sql — it also creates
//      e2e.admin@local.test, the admin with a TOTP factor that /admin needs).
//   2. a production build of apps/dcs on Node 20: `pnpm --filter @scl/dcs exec next
//      build`, then `pnpm --filter @scl/dcs exec next start --port 3001`.
//   3. Chromium: `pnpm --filter @scl/dcs exec playwright install chromium`.
// Then: `pnpm --filter @scl/dcs e2e:pending`. Exit code 1 if any save hangs, is not
// committed, or a step errors.
//
// Optional environment:
//   E2E_REPEAT   attempts per screen (default 5)
//   E2E_PROBE_N  attempts for the two screens known to sit under the boundary that
//                caused the defect — the CPY field and /mdr (default 30)
//   E2E_SITES    comma list to run only some: cpy,addmember,roles,editproject,
//                clients,dictionaries,mdr,wizard,docform,addfile
//                (addfile — DCS 1b.09, the Add File dialog: E2E_PROBE_N uploads
//                through the panel; "done" = the refreshed file list carries
//                one more server-rendered row)
//   E2E_BASE_URL, E2E_SUPABASE_URL, E2E_DB_CONTAINER, E2E_SHOTS
//
// Not in this file, because they already have a script: NewRevisionDialog
// (`e2e:revision`) and the CPY field's own assertions (`e2e:profile`). Run those two
// as well for the twelve-caller proof — see the table in the conventions doc.
/* global document, location */
import { BASE, IDS, guardLocal, go, holds, launch, psql, session, shot, toAal2 } from './support.mjs'

guardLocal()

const REPEAT = Number(process.env.E2E_REPEAT ?? 5)
const PROBE_N = Number(process.env.E2E_PROBE_N ?? 30)
const ONLY = process.env.E2E_SITES ? new Set(process.env.E2E_SITES.split(',').map((s) => s.trim())) : null
const want = (id) => !ONLY || ONLY.has(id)
const pad = (n) => String(n).padStart(3, '0')

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

/** Every spinner the DCS forms show while pending is a lucide Loader2 (`animate-spin`); skeletons use `animate-pulse`. */
const PENDING_GONE = () => !document.querySelector('.animate-spin') && !/(Saving|Adding|Creating)…/.test(document.body.innerText)

const errors = []
const tally = new Map()

function row(id, callers) {
  if (!tally.has(id)) tally.set(id, { callers, attempts: 0, notCommitted: 0, stuckPending: 0, notStored: 0, errors: [], details: [] })
  return tally.get(id)
}

/**
 * One save. `act` performs the click; `committed` (evaluated in the page, with
 * `arg`) must become true within 6 s — that is the refreshed tree being on screen —
 * and then the pending indicator must be gone within 3 s more.
 *
 * Failure modes are counted separately on purpose:
 *   notCommitted  the tree never arrived (the defect)
 *   stuckPending  it arrived but the pending flag never cleared
 *   errors        the script could not perform the step at all (a selector, a
 *                 refusal) — a defect in this file or in the app, not a hang
 */
async function attempt(id, page, act, committed, arg) {
  const r = tally.get(id)
  r.attempts += 1
  try {
    await act()
  } catch (e) {
    r.errors.push(e.message.split('\n')[0].slice(0, 200))
    return false
  }
  if (!(await holds(page, committed, arg, 6000))) {
    r.notCommitted += 1
    // What the page looked like when the tree failed to arrive: a still-spinning button means the hook is
    // waiting on a refresh that never lands (the defect); no spinner means the save was refused or the
    // assertion itself is wrong, and that is a different problem.
    r.details.push(
      `not committed after 6 s: ${await page.evaluate(() => `spinners=${document.querySelectorAll('.animate-spin').length} disabledButtons=${document.querySelectorAll('button:disabled').length} alert="${(document.querySelector('[role=alert], .text-destructive')?.textContent ?? '').trim().slice(0, 80)}"`)}`,
    )
    return false
  }
  if (!(await holds(page, PENDING_GONE, null, 3000))) {
    r.stuckPending += 1
    r.details.push(
      `pending never cleared: ${await page.evaluate(() => JSON.stringify(Array.from(document.querySelectorAll('.animate-spin')).map((e) => (e.closest('button')?.textContent ?? e.parentElement?.tagName ?? '?').trim().slice(0, 40))))}`,
    )
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const browser = await launch()
const started = Date.now()

// The DC of SC2602 (verified TOTP factor from the fixture) and the admin (verified factor from the fixture).
let dc = null
let admin = null
let orig = null
const needDc = () => want('cpy') || want('mdr')
const needAdmin = () => ['addmember', 'roles', 'editproject', 'clients', 'dictionaries', 'wizard'].some(want)

if (needDc()) {
  dc = await session(browser, 'dc.profile@local.test', errors)
  await toAal2(dc.page, `/documents/${IDS.DOC_A}`)
}
if (needAdmin()) {
  admin = await session(browser, 'e2e.admin@local.test', errors)
  await toAal2(admin.page, `/admin/projects/${IDS.PEJ}`)
}
if (want('docform') || want('addfile')) orig = await session(browser, 'orig.profile@local.test', errors)

// ---------------------------------------------------------------------------
// 1. CpyNumberField — /documents/[documentId] (on a document of this script's own)
// ---------------------------------------------------------------------------
if (want('cpy')) {
  const { page } = dc
  row('cpy', 'CpyNumberField')
  const cpy = tally.get('cpy')
  // Its own document, not the fixture's DOC_A: this loop writes an audit row per attempt (and one more per reset),
  // which pushed DOC_A's History past the 200 rows the tab reads and broke e2e:profile's "System (no session)" check.
  const doc = IDS.DOC_PENDING
  psql(`insert into dcs.documents (
          id, project_id, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id,
          originator_id, checker_id, approver_id, budget_hours)
        select '${doc}', '${IDS.PEJ}', 'E2E pending-action CPY document',
          (select id from dcs.dictionaries where dict_type = 'doc_type' and code = 'RA'),
          (select id from dcs.dictionaries where dict_type = 'discipline' and code = 'A00'),
          (select id from dcs.dictionaries where dict_type = 'area' and code = '00'),
          (select id from dcs.dictionaries where dict_type = 'language' and code = 'EN'),
          (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = 'NOT_STARTED'),
          '${IDS.ORIG}', null, '${IDS.DC}', 60
         where not exists (select 1 from dcs.documents where id = '${doc}')`)
  for (let i = 1; i <= PROBE_N; i++) {
    const value = `CPY-E2E-${pad(i)}`
    psql(`update dcs.documents set cpy_doc_number = null where id = '${doc}'`)
    await go(page, `${BASE}/documents/${doc}`)
    await page.getByLabel('Client (CPY) number').fill(value)
    // The field is remounted by its parent (key = stored value) when the refreshed tree is
    // committed, so the mark disappears exactly then — a cleared spinner cannot fake that.
    await page.evaluate(() => document.querySelector('input[aria-label="Client (CPY) number"]').setAttribute('data-probe-marker', '1'))
    await attempt('cpy', page, () => page.getByRole('button', { name: 'Save' }).click(), () => !document.querySelector('[data-probe-marker]'))
    if (psql(`select coalesce(cpy_doc_number, '') from dcs.documents where id = '${doc}'`) !== value) cpy.notStored += 1
  }
  psql(`delete from dcs.documents where id = '${doc}'`)
}

// ---------------------------------------------------------------------------
// 2-4. Project team screen — AddMemberForm, RoleCheckboxGroup, EditProjectDialog
// ---------------------------------------------------------------------------
if (want('addmember')) {
  const { page } = admin
  row('addmember', 'AddMemberForm')
  for (let i = 1; i <= REPEAT; i++) {
    psql(`delete from dcs.project_roles where project_id = '${IDS.PEJ}' and user_id = '${IDS.OUTSIDER}'`)
    await go(page, `${BASE}/admin/projects/${IDS.PEJ}`)
    const form = page.locator('div.border-dashed').filter({ has: page.getByLabel('Add a member') })
    await attempt(
      'addmember',
      page,
      async () => {
        await form.getByLabel('Add a member').selectOption({ label: 'Olga Outsider' })
        await form.locator('label', { hasText: /^\s*Viewer\s*$/ }).locator('input').check()
        await form.getByRole('button', { name: 'Add', exact: true }).click()
      },
      // A card for her appears in Team AND she leaves the candidate list: both come from the refreshed server tree.
      () =>
        Array.from(document.querySelectorAll('div.text-sm.font-medium')).some((d) => d.textContent.trim() === 'Olga Outsider') &&
        !Array.from(document.querySelectorAll('select[aria-label="Add a member"] option')).some((o) => o.textContent.includes('Olga Outsider')),
    )
  }
  psql(`delete from dcs.project_roles where project_id = '${IDS.PEJ}' and user_id = '${IDS.OUTSIDER}'`)
}

if (want('roles')) {
  const { page } = admin
  row('roles', 'RoleCheckboxGroup')
  // The DC also gets a second role, so removing `dc` leaves the card in place and the only visible
  // consequence is the server-rendered "No Document Controller" warning — a cross-row effect that exists
  // only in the refreshed tree.
  const seedRoles = () =>
    psql(`insert into dcs.project_roles (project_id, user_id, role)
          select '${IDS.PEJ}', '${IDS.DC}', r::dcs.project_role from unnest(array['dc', 'view']) r
           where not exists (select 1 from dcs.project_roles x where x.project_id = '${IDS.PEJ}' and x.user_id = '${IDS.DC}' and x.role = r::dcs.project_role)`)
  const NO_DC = 'No Document Controller assigned to this project.'
  for (let i = 1; i <= REPEAT; i++) {
    seedRoles()
    await go(page, `${BASE}/admin/projects/${IDS.PEJ}`)
    const card = page.locator('div.rounded-lg.border').filter({ has: page.locator('div.text-sm.font-medium', { hasText: /^Dorota Controller$/ }) })
    const dcBox = card.locator('label', { hasText: 'Document Controller' }).locator('input')
    await attempt(
      'roles',
      page,
      async () => {
        await dcBox.uncheck()
        await card.getByRole('button', { name: 'Save' }).click()
      },
      (text) => document.body.innerText.includes(text),
      NO_DC,
    )
    // Same mounted component, second save: put the role back and the warning must go.
    await attempt(
      'roles',
      page,
      async () => {
        await dcBox.check()
        await card.getByRole('button', { name: 'Save' }).click()
      },
      (text) => !document.body.innerText.includes(text),
      NO_DC,
    )
  }
  seedRoles()
  psql(`delete from dcs.project_roles where project_id = '${IDS.PEJ}' and user_id = '${IDS.DC}' and role = 'view'`)
}

if (want('editproject')) {
  const { page } = admin
  row('editproject', 'EditProjectDialog')
  const original = psql(`select name from public.projects where id = '${IDS.PEJ}'`)
  for (let i = 1; i <= REPEAT; i++) {
    const name = `${original} e2e ${pad(i)}`
    await go(page, `${BASE}/admin/projects/${IDS.PEJ}`)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.locator('#edit-project-name').fill(name)
    await attempt(
      'editproject',
      page,
      () => page.getByRole('dialog').getByRole('button', { name: 'Save' }).click(),
      // The dialog stays open until the refreshed tree lands (hook comment, 1a.24), and the page then shows the new name.
      (n) => !document.querySelector('[role=dialog]') && document.body.innerText.includes(n),
      name,
    )
  }
  psql(`update public.projects set name = '${original.replace(/'/g, "''")}' where id = '${IDS.PEJ}'`)
}

// ---------------------------------------------------------------------------
// 5-6. /admin/clients — ClientDialog (add, edit) and ClientsTable (deactivate / reactivate)
// ---------------------------------------------------------------------------
if (want('clients')) {
  const { page } = admin
  row('clients.add', 'ClientDialog (add)')
  row('clients.edit', 'ClientDialog (edit)')
  row('clients.toggle', 'ClientsTable')
  for (let i = 1; i <= REPEAT; i++) {
    const code = `E2E${pad(i)}`
    psql(`delete from public.clients where code like 'E2E%'`)
    await go(page, `${BASE}/admin/clients`)
    await page.getByRole('button', { name: 'Add client' }).click()
    await page.locator('#client-name').fill(`E2E client ${pad(i)}`)
    await page.locator('#client-code').fill(code)
    await attempt(
      'clients.add',
      page,
      () => page.getByRole('dialog').getByRole('button', { name: 'Save' }).click(),
      (c) => !document.querySelector('[role=dialog]') && Array.from(document.querySelectorAll('tbody tr')).some((tr) => tr.textContent.includes(c)),
      code,
    )
    const tr = page.locator('tbody tr').filter({ hasText: code })
    await tr.getByRole('button', { name: 'Edit' }).click()
    await page.locator('#client-name').fill(`E2E client ${pad(i)} edited`)
    await attempt(
      'clients.edit',
      page,
      () => page.getByRole('dialog').getByRole('button', { name: 'Save' }).click(),
      (c) => !document.querySelector('[role=dialog]') && Array.from(document.querySelectorAll('tbody tr')).some((r) => r.textContent.includes(c) && r.textContent.includes('edited')),
      code,
    )
    // Same page, same mounted table: deactivate. An inactive client is not listed, so the row leaves the table —
    // but only in the refreshed tree, which is what the mark on the row detects.
    await tr.evaluate((el) => el.setAttribute('data-probe-marker', '1'))
    await attempt('clients.toggle', page, () => tr.getByRole('button', { name: 'Deactivate' }).click(), () => !document.querySelector('[data-probe-marker]'))
  }
  psql(`delete from public.clients where code like 'E2E%'`)
}

// ---------------------------------------------------------------------------
// 7-8. /admin/dictionaries — DictionaryEntryDialog and DictionaryTypeTable
// ---------------------------------------------------------------------------
if (want('dictionaries')) {
  const { page } = admin
  row('dictionaries.add', 'DictionaryEntryDialog')
  row('dictionaries.toggle', 'DictionaryTypeTable')
  const reset = () => {
    psql(`delete from dcs.dictionaries where dict_type = 'doc_type' and code like 'E2E%'`)
    psql(`update dcs.dictionaries set is_active = true where dict_type = 'doc_type'`)
  }
  for (let i = 1; i <= REPEAT; i++) {
    reset()
    const code = `E2E${i}`
    await go(page, `${BASE}/admin/dictionaries`)
    await page.getByRole('button', { name: /^Add / }).first().click()
    await page.locator('#dict-code').fill(code)
    await page.locator('#dict-label').fill(`E2E entry ${i}`)
    await attempt(
      'dictionaries.add',
      page,
      () => page.getByRole('dialog').getByRole('button', { name: 'Save' }).click(),
      (c) => !document.querySelector('[role=dialog]') && Array.from(document.querySelectorAll('tbody tr')).some((tr) => tr.textContent.includes(c)),
      code,
    )
    // Deactivate a row: with "Show inactive" off it leaves the table, but only when the refreshed tree is committed.
    const first = page.getByRole('button', { name: 'Deactivate' }).first()
    await first.evaluate((el) => el.closest('tr').setAttribute('data-probe-marker', '1'))
    await attempt('dictionaries.toggle', page, () => first.click(), () => !document.querySelector('[data-probe-marker]'))
  }
  reset()
}

// ---------------------------------------------------------------------------
// 9. /mdr — MdrToolbar: save, rename, make default, delete (each refreshes) and export (run only)
// ---------------------------------------------------------------------------
if (want('mdr')) {
  const { page } = dc
  for (const id of ['save', 'rename', 'default', 'delete']) row(`mdr.${id}`, 'MdrToolbar')
  row('mdr.export', 'MdrToolbar (export, no refresh)')
  const clean = () => psql(`delete from dcs.user_views where user_id = '${IDS.DC}' and name like 'e2e-%'`)
  for (let i = 1; i <= PROBE_N; i++) {
    clean()
    const name = `e2e-view-${pad(i)}`
    const renamed = `e2e-renamed-${pad(i)}`
    await go(page, `${BASE}/mdr`)
    await page.getByRole('button', { name: 'Save current view' }).click()
    await page.locator('#mdr-view-name').fill(name)
    // The view appears in "My views" only in the refreshed tree (the list is server data).
    const saved = await attempt(
      'mdr.save',
      page,
      () => page.getByRole('dialog').getByRole('button', { name: 'Save' }).click(),
      (n) => Array.from(document.querySelectorAll('select option')).some((o) => o.textContent.trim() === n) && !document.querySelector('[role=dialog]'),
      name,
    )
    if (!saved) continue
    // Opening a view is a navigation (router.push) — the toolbar's next buttons exist only on an open view.
    await page.locator('select').first().selectOption({ label: name })
    await holds(page, () => !!Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Rename'), null, 8000)
    await page.getByRole('button', { name: 'Rename' }).click()
    await page.locator('#mdr-view-name').fill(renamed)
    await attempt(
      'mdr.rename',
      page,
      () => page.getByRole('dialog').getByRole('button', { name: 'Save' }).click(),
      (n) => Array.from(document.querySelectorAll('select option')).some((o) => o.textContent.trim() === n) && !document.querySelector('[role=dialog]'),
      renamed,
    )
    await attempt(
      'mdr.default',
      page,
      () => page.getByRole('button', { name: 'Make default' }).click(),
      (n) => Array.from(document.querySelectorAll('select option')).some((o) => o.textContent.trim() === `★ ${n}`),
      renamed,
    )
    {
      const download = page.waitForEvent('download', { timeout: 15000 }).then(() => true, () => false)
      await attempt('mdr.export', page, () => page.getByRole('button', { name: /^Export to Excel/ }).click(), () => true)
      if (!(await download)) tally.get('mdr.export').errors.push('no download event')
    }
    await attempt(
      'mdr.delete',
      page,
      () => page.getByRole('button', { name: 'Delete' }).click(),
      (n) => !Array.from(document.querySelectorAll('select option')).some((o) => o.textContent.trim().endsWith(n)),
      renamed,
    )
  }
  clean()
}

// ---------------------------------------------------------------------------
// 10. /admin/projects/new — CreateProjectWizard (run, then router.push + router.refresh outside the hook)
// ---------------------------------------------------------------------------
if (want('wizard')) {
  const { page } = admin
  row('wizard', 'CreateProjectWizard')
  const drop = () => {
    psql(`delete from public.sub_projects where project_id in (select id from public.projects where project_code = 'SC9901')`)
    psql(`delete from public.projects where project_code = 'SC9901'`)
  }
  for (let i = 1; i <= REPEAT; i++) {
    drop()
    const name = `E2E project ${pad(i)}`
    await go(page, `${BASE}/admin/projects/new`)
    await page.locator('#project-code').fill('SC9901')
    await page.locator('#project-name').fill(name)
    // Walk the stepper with the wizard's own Next until the last step offers "Create project".
    for (let step = 0; step < 8; step++) {
      const create = page.getByRole('button', { name: /^Create project/ })
      if (await create.count()) break
      await page.getByRole('button', { name: /^Next/ }).click()
    }
    await attempt(
      'wizard',
      page,
      () => page.getByRole('button', { name: /^Create project/ }).click(),
      (n) => /^\/admin\/projects\/[0-9a-f-]{36}$/.test(location.pathname) && document.body.innerText.includes(n),
      name,
    )
  }
  drop()
}

// ---------------------------------------------------------------------------
// 11. /documents/new — DocumentCreateForm (run, then router.push)
// ---------------------------------------------------------------------------
if (want('docform')) {
  const { page } = orig
  row('docform', 'DocumentCreateForm')
  const drop = () => psql(`delete from dcs.documents where title like 'E2E doc %'`)
  for (let i = 1; i <= REPEAT; i++) {
    drop()
    const title = `E2E doc ${pad(i)}`
    await go(page, `${BASE}/documents/new`)
    await page.locator('#title').fill(title)
    for (const id of ['docType', 'discipline', 'area']) {
      const value = await page.locator(`#${id} option:not([value=""])`).first().getAttribute('value')
      await page.locator(`#${id}`).selectOption(value)
    }
    await attempt(
      'docform',
      page,
      () => page.getByRole('button', { name: 'Create document' }).click(),
      (t) => /^\/documents\/[0-9a-f-]{36}$/.test(location.pathname) && document.body.innerText.includes(t),
      title,
    )
  }
  drop()
}

// ---------------------------------------------------------------------------
// 13. AddFileDialog — /documents/[documentId], the panel's Add File (DCS 1b.09)
// ---------------------------------------------------------------------------
if (want('addfile')) {
  const { page } = orig
  row('addfile', 'AddFileDialog')
  const site = tally.get('addfile')
  // Its own document with one revision; the folder's objects are removed with it at the end (local only:
  // the storage-api's delete guard is stood aside for that statement).
  const doc = 'f3000000-0000-4000-8000-0000000000f1'
  const rev = 'f4000000-0000-4000-8000-0000000000f1'
  const dict = (type, code) => psql(`select id from dcs.dictionaries where dict_type = '${type}' and code = '${code}'`)
  const cleanFiles = () => {
    const folder = psql(`select 'SC2602/' || scl_doc_number || '/' from dcs.documents where id = '${doc}'`)
    if (folder) psql(`set storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id = 'dcs-documents' and name like '${folder}%'`)
    psql(`delete from dcs.documents where id = '${doc}'`)
  }
  cleanFiles()
  psql(`insert into dcs.documents (id, project_id, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id, originator_id)
        values ('${doc}', '${IDS.PEJ}', 'E2E pending-action Add File document', '${dict('doc_type', 'RA')}', '${dict('discipline', 'A00')}',
                '${dict('area', '00')}', '${dict('language', 'EN')}', '${dict('workflow_status', 'NOT_STARTED')}', '${IDS.ORIG}');
        insert into dcs.revisions (id, document_id, project_id, scl_revision, step_id, status_id, revision_date, created_by)
        values ('${rev}', '${doc}', '${IDS.PEJ}', 'A', '${dict('workflow_step', 'IDC')}', '${dict('workflow_status', 'IDC')}', date '2026-09-19', '${IDS.ORIG}')`)
  const PANEL = 'aside[aria-label="Current revision"]'
  for (let i = 1; i <= PROBE_N; i++) {
    await go(page, `${BASE}/documents/${doc}`)
    const before = await page.locator(`${PANEL} [data-file-row]`).count()
    await attempt(
      'addfile',
      page,
      async () => {
        await page.locator(`${PANEL} button[data-add-file="A"]`).click()
        const dialog = page.getByRole('dialog')
        await dialog.waitFor()
        await dialog.locator('input[type=file]').setInputFiles({ name: `probe-${pad(i)}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`probe ${i}`) })
        await dialog.getByRole('button', { name: 'Upload' }).click()
      },
      // One more server-rendered file row in the panel: the refreshed tree, not the cleared spinner.
      (n) => document.querySelectorAll('aside[aria-label="Current revision"] [data-file-row]').length > n,
      before,
    )
    if (Number(psql(`select count(*) from dcs.files where revision_id = '${rev}'`)) !== i) site.notStored += 1
  }
  cleanFiles()
}

await shot((admin ?? dc ?? orig).page, 'pending-action-last-page', { fullPage: true }).catch(() => undefined)
await browser.close()

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log(`\nbuild under test: ${BASE}   repeat=${REPEAT}  probeN=${PROBE_N}   ${Math.round((Date.now() - started) / 1000)} s`)
console.log('site                    attempts  not-committed  stuck-pending  not-stored  step-errors   callers')
let bad = 0
for (const [id, r] of tally) {
  const failed = r.notCommitted + r.stuckPending + r.notStored + r.errors.length
  bad += failed
  console.log(
    `${failed === 0 ? 'PASS' : 'FAIL'}  ${id.padEnd(20)} ${String(r.attempts).padStart(6)} ${String(r.notCommitted).padStart(13)} ${String(r.stuckPending).padStart(14)} ${String(r.notStored).padStart(11)} ${String(r.errors.length).padStart(12)}   ${r.callers}`,
  )
  for (const message of [...new Set(r.errors)].slice(0, 3)) console.log(`        step error: ${message}`)
  for (const message of [...new Set(r.details)].slice(0, 3)) console.log(`        ${message}`)
}
if (errors.length) {
  bad += errors.length
  console.log(`\nFAIL  console / page errors (${errors.length}):`)
  for (const e of [...new Set(errors)].slice(0, 10)) console.log(`      ${e}`)
}
if (bad > 0) process.exit(1)
console.log('\nAll saves committed their tree and cleared their pending state.')
