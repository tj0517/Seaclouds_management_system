// DCS 1b.08 — browser proof of the New Revision dialog and the Revisions tab, run
// by hand against the LOCAL stack. Not part of CI (docs/03-conventions.md,
// "Testy przeglądarkowe"). Companion to document-profile.mjs (1b.07): same
// prerequisites, same fixture, same helpers (duplicated here on purpose so the
// 1b.07 script stays byte-for-byte what it was — extract to a shared module when
// a third script needs them, docs/deferred-tasks.md yy).
//
// Why a browser script and not a component test: vitest here is node-only, no
// jsdom (DCS 1a.12). What a component decides is proven through the pure function
// it calls (lib/revisions.test.ts); what the PAGE does — the proposal changing
// with the step, the database assigning the code, the row appearing expanded on
// the Revisions tab, the previous revision turning SUPERSEDED — only an end-to-end
// run shows, and this is that run. The database rules themselves are proven in
// supabase/tests/scl_revision_generator.test.sql and revision_promotion.test.sql.
//
// Prerequisites (all local):
//   1. `supabase start` + `supabase db reset`
//   2. the 1b.07 fixture, loaded by hand:
//        docker exec -i -e PGOPTIONS='-c app.local_fixture=yes' \
//          supabase_db_Seaclouds_management_system \
//          psql -U postgres -v ON_ERROR_STOP=1 < supabase/fixtures/document_profile.sql
//   3. the app on port 3001 against the local stack — a PRODUCTION build is the
//      faithful run (`pnpm --filter @scl/dcs build && pnpm --filter @scl/dcs start`);
//      `pnpm --filter @scl/dcs dev` is the quick one
//   4. a browser: `pnpm --filter @scl/dcs exec playwright install chromium`
// Then: `pnpm --filter @scl/dcs e2e:revision`. Exit code 1 if any check fails.
//
// It creates its own documents (fixed ids, deleted again at the end and at the
// start of the next run) so it does not consume the fixture's, and it WRITES to
// the local database — it refuses to run against anything that is not localhost.
// Optional environment: E2E_BASE_URL, E2E_SUPABASE_URL, E2E_ANON_KEY (else
// NEXT_PUBLIC_SUPABASE_ANON_KEY, else apps/dcs/.env.local), E2E_DB_CONTAINER,
// E2E_SHOTS (screenshot directory, default: the OS temp dir).
/* global document */
import { chromium } from 'playwright'
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3001'
const API = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? 'supabase_db_Seaclouds_management_system'
const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'dcs-e2e-screenshots')

for (const url of [BASE, API]) {
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
    console.error(`Refusing to run: ${url} is not localhost. This script writes to the database.`)
    process.exit(2)
  }
}

function anonKey() {
  if (process.env.E2E_ANON_KEY) return process.env.E2E_ANON_KEY
  if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const envFile = path.join(here, '..', '.env.local')
  const line = fs.existsSync(envFile)
    ? fs.readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY='))
    : undefined
  if (!line) throw new Error('No anon key: set E2E_ANON_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY, or fill apps/dcs/.env.local')
  return line.slice(line.indexOf('=') + 1).trim()
}
const ANON = anonKey()
fs.mkdirSync(SHOTS, { recursive: true })

const PEJ = '6c0909ce-9b74-4bda-8e92-10811ff5a0fc' // SC2602, cpy_numbering = true after the fixture
// This script's own documents.
const D_ORIG = 'f5000000-0000-4000-8000-000000000001' // the Originator's ladder: A, B, 00
const D_DC = 'f5000000-0000-4000-8000-000000000002' // the DC's override
const D_VOID = 'f5000000-0000-4000-8000-000000000003' // a Void document
const MY_DOCS = [D_ORIG, D_DC, D_VOID]
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP'

const base32 = (s) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of s) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}
const totp = () => {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const hmac = crypto.createHmac('sha1', base32(TOTP_SECRET)).update(counter).digest()
  const offset = hmac[19] & 15
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1e6).padStart(6, '0')
}
const psql = (sql) =>
  execSync(`docker exec -i ${DB_CONTAINER} psql -U postgres -tA`, { input: sql }).toString().trim()

const results = []
const consoleErrors = []
const rec = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

async function session(browser, email, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(`${email}: ${m.text().slice(0, 300)}`)
  })
  page.on('pageerror', (e) => consoleErrors.push(`${email}: pageerror ${e.message.slice(0, 300)}`))
  await page.goto(`${BASE}/login`)
  await page.fill('#email', email)
  await page.fill('#password', 'password123')
  await page.click('button[type=submit]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 })
  return { ctx, page }
}

/** Navigates and waits for the streamed page: loading.tsx shows a skeleton first. */
async function go(page, url) {
  const response = await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !document.querySelector('.animate-pulse'), null, { timeout: 15000 }).catch(() => undefined)
  return response
}

/** aal1 -> aal2 through the real /mfa page, with a code computed from the fixture secret. */
async function toAal2(page, next) {
  await page.goto(`${BASE}/mfa?next=${encodeURIComponent(next)}`)
  await page.waitForSelector('input[inputmode=numeric]')
  await page.fill('input[inputmode=numeric]', totp())
  await Promise.all([page.waitForURL((u) => u.pathname.startsWith('/documents'), { timeout: 15000 }), page.keyboard.press('Enter')])
  await page.waitForLoadState('networkidle')
  await page.waitForSelector('h1', { timeout: 15000 })
}

const text = async (page) => page.locator('main').innerText().catch(() => page.locator('body').innerText())
// caret: 'initial' — a default screenshot writes an inline caret-color into every <input>, which a shot taken
// mid-hydration turns into a false React #418 (docs/03-conventions.md, "Pułapka: zrzut ekranu"). Measured here:
// 1 of 10 e2e:profile runs on 2026-09-21 (DCS 1b.09 PR 2) before this line, 0 of 10 after.
const shot = (page, name, options = {}) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), caret: 'initial', ...options })

async function accessToken(email) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  })
  return (await r.json()).access_token
}

// ---------------------------------------------------------------- setup
const dict = (type, code) => psql(`select id from dcs.dictionaries where dict_type = '${type}' and code = '${code}'`)
const STEP = Object.fromEntries(['IDC', 'IFR', 'RETCOM'].map((c) => [c, dict('workflow_step', c)]))
const STATUS = Object.fromEntries(['IDC', 'IFR'].map((c) => [c, dict('workflow_status', c)]))
if (!psql(`select 1 from auth.users where email = 'orig.profile@local.test'`)) {
  throw new Error('Fixture not loaded: no orig.profile@local.test. See the prerequisites at the top of this file.')
}

const clean = () => psql(`delete from dcs.documents where id in (${MY_DOCS.map((d) => `'${d}'`).join(',')})`)
clean()
// Written as postgres, so no session: the 1b.02 generator numbers them, and the status is set directly.
// void_reason is required on the VOID row since migration 20260922074250
// (DCS 1b.11 PR 1): enforce_document_void() has no `auth.uid() is null` bypass
// like the other guards in that migration, so even this session-less insert
// is checked — only dcs.import_mode = 'on' would skip it, and this fixture
// does not set that. docs/deferred-tasks.md (ggg).
psql(`
  insert into dcs.documents (id, project_id, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id, void_reason)
  select v.id, '${PEJ}', v.title,
         (select id from dcs.dictionaries where dict_type = 'doc_type' and code = 'RA'),
         (select id from dcs.dictionaries where dict_type = 'discipline' and code = 'A00'),
         (select id from dcs.dictionaries where dict_type = 'area' and code = '00'),
         (select id from dcs.dictionaries where dict_type = 'language' and code = 'EN'),
         (select id from dcs.dictionaries where dict_type = 'workflow_status' and code = v.status),
         v.void_reason
    from (values
      ('${D_ORIG}'::uuid, 'E2E 1b.08 Originator ladder', 'NOT_STARTED', null::text),
      ('${D_DC}'::uuid,   'E2E 1b.08 Document Controller override', 'NOT_STARTED', null::text),
      ('${D_VOID}'::uuid, 'E2E 1b.08 Void document', 'VOID', 'E2E fixture: pre-voided for the ladder''s Void case')
    ) as v(id, title, status, void_reason);
`)
const today = (() => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})()

const revisionsOf = (doc) =>
  psql(
    `select string_agg(r.scl_revision || ':' || s.code, ',' order by r.created_at, r.scl_revision)
       from dcs.revisions r join dcs.dictionaries s on s.id = r.status_id where r.document_id = '${doc}'`,
  )
const docState = (doc) =>
  psql(
    `select s.code || '|' || coalesce((select r.scl_revision from dcs.revisions r where r.id = d.current_revision_id), '-')
       from dcs.documents d join dcs.dictionaries s on s.id = d.workflow_status_id where d.id = '${doc}'`,
  )

const PANEL = 'aside[aria-label="Current revision"]'
const dialog = (page) => page.getByRole('dialog')
const openDialog = async (page) => {
  await page.locator(`${PANEL} button:has-text("New Revision")`).click()
  await dialog(page).waitFor()
}
/** The proposed code once it has arrived — the field shows "…" while the server answers. */
async function proposed(page) {
  const field = page.locator('#revision-scl')
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#revision-scl')
      const value = el && ('value' in el && el.tagName === 'INPUT' ? el.value : el.textContent)
      return value && value.trim() !== '' && value.trim() !== '…'
    },
    null,
    { timeout: 10000 },
  )
  return (await field.evaluate((el) => (el.tagName === 'INPUT' ? el.value : el.textContent))).trim()
}
const createAndLand = async (page) => {
  // The URL may ALREADY be ?tab=revisions&open=<previous> — waiting for "tab is revisions" would return at once,
  // before the server action has committed. Wait for the URL to CHANGE to the new revision's.
  const before = page.url()
  await dialog(page).getByRole('button', { name: 'Create revision' }).click()
  await page.waitForURL((u) => u.searchParams.get('tab') === 'revisions' && u.href !== before, { timeout: 15000 })
  await page.waitForLoadState('networkidle')
  await page.waitForSelector('[data-revision-row]', { timeout: 15000 })
}

const browser = await chromium.launch()

// =================================================================
// (a) The Originator: A, then B, then the step changes to IFR -> 00
// =================================================================
{
  const { ctx, page } = await session(browser, 'orig.profile@local.test')
  const url = `${BASE}/documents/${D_ORIG}`

  await go(page, url)
  let t = await text(page)
  rec('a: a document with no revision says "No revision yet"', /No revision yet/.test(t) && /NOT_STARTED/.test(t))
  await page.getByRole('tab', { name: 'Revisions' }).click()
  rec('a: the Revisions tab is a real tab with its own empty state, not a placeholder', /Use New Revision/.test(await text(page)) && !/not available yet/.test(await text(page)))

  // ---- first revision ----
  const newButton = page.locator(`${PANEL} button:has-text("New Revision")`)
  rec('a: New Revision is an enabled button for an Originator, at aal1', (await newButton.count()) === 1 && (await newButton.isEnabled()))
  await openDialog(page)
  const d = dialog(page)
  rec('a: the dialog opens on the IDC step (a document with no revision starts at the first step)', /IDC/.test(await d.locator('#revision-step option:checked').innerText()))
  const stepLabels = await d.locator('#revision-step option').allInnerTexts()
  rec(
    'a: the steps offered are IDC, IFR, IFC, IFI, IFB — RETCOM is not offered (it has no series)',
    stepLabels.length === 5 && ['IDC', 'IFR', 'IFC', 'IFI', 'IFB'].every((c, i) => stepLabels[i].startsWith(c)) && !stepLabels.some((l) => /RETCOM/.test(l)),
    stepLabels.join(' | '),
  )
  rec('a: the SCL revision is proposed as A', (await proposed(page)) === 'A')
  rec('a: it is read-only for an Originator (an <output>, no input to type in)', (await d.locator('input#revision-scl').count()) === 0 && (await d.locator('output#revision-scl').count()) === 1)
  rec('a: no CPY revision field for an Originator — the 1b.03 trigger makes it DC-only — and a sentence says who sets it', (await d.getByLabel('Client (CPY) revision').count()) === 0 && /set by the project’s Document Controller/.test(await d.innerText()))
  rec('a: no comment field (dcs.revisions has none; comments are Phase 2)', (await d.getByLabel(/comment/i).count()) === 0 && !/Comment/.test(await d.innerText()))
  rec('a: the revision date defaults to today and is required', (await d.locator('#revision-date').inputValue()) === today && (await d.locator('#revision-date').getAttribute('required')) !== null)
  const acceptance = await d.locator('#revision-acceptance option').allInnerTexts()
  rec('a: the acceptance code is optional and comes from the dictionary (— none — plus 4 codes)', acceptance.length === 5 && /none/.test(acceptance[0]), acceptance.join(' | '))
  await d.locator('#revision-reason').fill('E2E first issue')
  await shot(page, 'a1-dialog-first-revision')
  await createAndLand(page)

  const rowA = page.locator('[data-revision-row="A"]')
  rec('a: it landed on the Revisions tab (?tab=revisions&open=…) with the new row present', (await rowA.count()) === 1)
  rec('a: the new row is EXPANDED, showing an empty file list', (await page.locator('[data-revision-files="A"]').count()) === 1 && /No files on this revision\./.test(await page.locator('[data-revision-files="A"]').innerText()))
  const cellsA = await rowA.innerText()
  rec('a: the row shows step, date, author, status and reason', /IDC/.test(cellsA) && cellsA.includes(today) && /Oskar Originator/.test(cellsA) && /E2E first issue/.test(cellsA))
  rec('a: it is marked Current', /Current/.test(cellsA))
  rec('a: the expanded row offers Add File to the Originator (1b.09; what it does is revision-files.mjs)', (await page.locator('[data-revision-files="A"] button[data-add-file="A"]').count()) === 1)
  rec('a: the document header moved to STARTED', /STARTED/.test(await page.locator('h1').locator('xpath=ancestor::header').innerText()))
  rec('a/DB: A is current and the document is STARTED', docState(D_ORIG) === 'STARTED|A', docState(D_ORIG))
  await shot(page, 'a2-revisions-tab-first-revision', { fullPage: true })

  // ---- second revision ----
  await openDialog(page)
  rec('a: the second revision is proposed as B — same step as the current revision, plus one', (await proposed(page)) === 'B')
  await createAndLand(page)
  const rowB = page.locator('[data-revision-row="B"]')
  const rowA2 = page.locator('[data-revision-row="A"]')
  rec('a: B is current and expanded, A is SUPERSEDED and collapsed', (await rowB.innerText()).includes('Current') && /SUPERSEDED/.test(await rowA2.innerText()) && (await page.locator('[data-revision-files="B"]').count()) === 1 && (await page.locator('[data-revision-files="A"]').count()) === 0)
  rec('a/DB: A is SUPERSEDED, B keeps IDC, current is B', revisionsOf(D_ORIG) === 'A:SUPERSEDED,B:IDC' && docState(D_ORIG) === 'STARTED|B', `${revisionsOf(D_ORIG)} / ${docState(D_ORIG)}`)
  const toggle = rowA2.getByRole('button')
  rec('a: a collapsed row expands to its files on click', (await toggle.getAttribute('aria-expanded')) === 'false')
  await toggle.click()
  rec('a: … and shows its (empty) file list, with the button reporting aria-expanded=true', (await toggle.getAttribute('aria-expanded')) === 'true' && (await page.locator('[data-revision-files="A"]').count()) === 1)
  await shot(page, 'a3-revisions-tab-two-revisions', { fullPage: true })

  // ---- switching the step to IFR: 00, not C ----
  await openDialog(page)
  await proposed(page)
  await dialog(page).locator('#revision-step').selectOption(STEP.IFR)
  await page.waitForFunction(() => document.querySelector('#revision-scl')?.textContent?.trim() === '00', null, { timeout: 10000 }).catch(() => undefined)
  const afterSwitch = await proposed(page)
  rec('a: switching the step to IFR proposes 00, not C (acceptance 1)', afterSwitch === '00', `proposed ${afterSwitch}`)
  await shot(page, 'a4-dialog-ifr-proposal')
  await createAndLand(page)
  rec('a/DB: the ladder is A, B, 00 with only 00 live and current', revisionsOf(D_ORIG) === 'A:SUPERSEDED,B:SUPERSEDED,00:IFR' && docState(D_ORIG) === 'STARTED|00', `${revisionsOf(D_ORIG)} / ${docState(D_ORIG)}`)

  // ---- the register follows without a change to the view (acceptance 6) ----
  const mdr = psql(`select scl_revision || '|' || coalesce(issue_date::text, '') || '|' || workflow_status_code from dcs.v_mdr where document_id = '${D_ORIG}'`)
  rec('a/6: dcs.v_mdr shows the new SCL revision, its date and the document status — the view is unchanged', mdr === `00|${today}|STARTED`, mdr)

  // The panel and the History tab.
  await go(page, url)
  t = await text(page)
  rec('a: the current-revision panel shows 00 / IFR', /SCL revision\s*\n?\s*00/.test(t))
  await page.getByRole('tab', { name: 'History' }).click()
  await ctx.close()

  // ---- RED PROOF: the Originator supplies a code directly, as PostgREST would receive it ----
  const jwt = await accessToken('orig.profile@local.test')
  const before = revisionsOf(D_ORIG)
  const post = (body, token = jwt) =>
    fetch(`${API}/rest/v1/revisions`, {
      method: 'POST',
      headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-profile': 'dcs', prefer: 'return=representation' },
      body: JSON.stringify(body),
    })
  const forged = await post({ document_id: D_ORIG, project_id: PEJ, scl_revision: 'Z', step_id: STEP.IDC, status_id: STATUS.IDC })
  const forgedBody = await forged.text()
  rec(
    'RED 1: an ORIG supplying scl_revision directly is refused by the database (42501) and nothing is written',
    forged.status === 403 && /42501/.test(forgedBody) && revisionsOf(D_ORIG) === before,
    `HTTP ${forged.status} ${forgedBody.slice(0, 110)}`,
  )
  const generated = await post({ document_id: D_ORIG, project_id: PEJ, step_id: STEP.IDC, status_id: STATUS.IDC })
  const generatedBody = await generated.json().catch(() => ({}))
  rec(
    'RED 1b: the same insert with scl_revision LEFT OUT is accepted and the database numbers it (C — the IDC series continues past A, B)',
    generated.status === 201 && generatedBody[0]?.scl_revision === 'C',
    `HTTP ${generated.status} → ${generatedBody[0]?.scl_revision}`,
  )
}

// =================================================================
// (b) A Void document accepts no revision
// =================================================================
{
  const { ctx, page } = await session(browser, 'orig.profile@local.test')
  await go(page, `${BASE}/documents/${D_VOID}`)
  const button = page.locator(`${PANEL} button:has-text("New Revision")`)
  const hint = await page.locator('#panel-action-new-revision-hint').innerText().catch(() => '')
  rec('b/RED: on a Void document New Revision is disabled and says why', (await button.isDisabled()) && /Void/.test(hint), hint)
  await shot(page, 'b1-void-disabled', { fullPage: true })
  await ctx.close()

  const jwt = await accessToken('orig.profile@local.test')
  const response = await fetch(`${API}/rest/v1/revisions`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${jwt}`, 'content-type': 'application/json', 'content-profile': 'dcs' },
    body: JSON.stringify({ document_id: D_VOID, project_id: PEJ, step_id: STEP.IDC, status_id: STATUS.IDC }),
  })
  const body = await response.text()
  rec(
    'b/RED: a revision inserted on the Void document directly is refused by the database (23514) — the disabled button is not the enforcement',
    response.status === 400 && /23514/.test(body) && /Void/.test(body) && revisionsOf(D_VOID) === '',
    `HTTP ${response.status} ${body.slice(0, 110)}`,
  )
}

// =================================================================
// (c) The Document Controller: aal1 cannot, aal2 chooses a code
// =================================================================
{
  const { ctx, page } = await session(browser, 'dc.profile@local.test')
  const url = `${BASE}/documents/${D_DC}`
  await go(page, url)
  const button = page.locator(`${PANEL} button:has-text("New Revision")`)
  rec(
    'c/RED: a DC at aal1 (not an Originator) gets a disabled New Revision that asks for the second factor',
    (await button.isDisabled()) && /verified second factor/.test(await page.locator('#panel-action-new-revision-hint').innerText()),
  )
  await shot(page, 'c1-dc-aal1-disabled', { fullPage: true })

  await toAal2(page, `/documents/${D_DC}`)
  await openDialog(page)
  const d = dialog(page)
  const proposal = await proposed(page)
  rec('c: at aal2 the SCL revision is an editable field, pre-filled with the proposal (A)', (await d.locator('input#revision-scl').count()) === 1 && proposal === 'A')
  rec('c: the DC of a project that runs a CPY track sees the client (CPY) revision field', (await d.getByLabel('Client (CPY) revision').count()) === 1)

  // RED: a code of the wrong shape for the step is refused, the dialog stays open and says why.
  await d.locator('input#revision-scl').fill('ZZ')
  await d.getByRole('button', { name: 'Create revision' }).click()
  await page.waitForSelector('[role=alert]', { timeout: 10000 })
  const alertText = await d.locator('[role=alert]').innerText()
  rec(
    'c/RED: a DC-typed code of the wrong shape (ZZ on IDC) is refused with the database’s sentence; the dialog stays open and nothing is written',
    /not a valid code for step IDC/.test(alertText) && (await d.isVisible()) && revisionsOf(D_DC) === '',
    alertText.slice(0, 120),
  )
  await shot(page, 'c2-dc-wrong-shape-refused')

  // GREEN: a valid code, out of sequence, with a CPY revision.
  await d.locator('input#revision-scl').fill('E')
  await d.getByLabel('Client (CPY) revision').fill('CLIENT-E')
  await d.locator('#revision-reason').fill('E2E DC chose the code')
  await createAndLand(page)
  const rowE = page.locator('[data-revision-row="E"]')
  rec('c: the code the DC chose (E) was stored — acceptance 2, a DC at aal2 may supply one', (await rowE.count()) === 1 && revisionsOf(D_DC) === 'E:IDC', revisionsOf(D_DC))
  rec('c: the CPY revision shows in its column', /CLIENT-E/.test(await rowE.innerText()))
  rec('c/DB: E is current and the document is STARTED', docState(D_DC) === 'STARTED|E', docState(D_DC))
  await shot(page, 'c3-dc-chose-code', { fullPage: true })

  // The register's status filter does not offer SUPERSEDED (a status of a revision, not of a document).
  await go(page, `${BASE}/mdr`)
  const options = await page.locator('select[name=status] option').allInnerTexts()
  rec(
    'c: the /mdr status filter offers the nine document statuses and NOT Superseded',
    options.filter((o) => o !== 'All').length === 9 && options.some((o) => /Void/.test(o)) && !options.some((o) => /superseded/i.test(o)),
    options.join(' | '),
  )
  await ctx.close()
}

rec('no console or hydration errors on any page of any session', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' || '))
clean()
await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${SHOTS}`)
process.exit(failed.length ? 1 : 0)
