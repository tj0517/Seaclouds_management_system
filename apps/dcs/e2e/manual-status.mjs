// DCS 1b.11 — browser proof of the manual status control, Void and Approve
// on the document profile, run by hand against the LOCAL stack. Not part of
// CI (docs/03-conventions.md, "Testy przeglądarkowe"). Same prerequisites,
// same fixture, same helpers as document-profile.mjs / new-revision.mjs —
// duplicated here on purpose (docs/deferred-tasks.md yy).
//
// What this proves that lib/documents.test.ts and lib/revisions.test.ts
// cannot: the actual page — the status ladder NOT_STARTED -> STARTED -> IDC
// -> IFR -> RETCOM -> IFC, a revision's own status control, Approve locking a
// revision, Void with its mandatory reason and the audit trail it leaves, and
// that a non-DC reader gets no status/Void/Approve control at all, not merely
// a disabled one. The database rules are proven in
// supabase/tests/dc_manual_status_and_void.test.sql and
// supabase/tests/final_revision_lock.test.sql.
//
// Prerequisites (all local):
//   1. `supabase start` + `supabase db reset`
//   2. the 1b.07 fixture, loaded by hand:
//        docker exec -i -e PGOPTIONS='-c app.local_fixture=yes' \
//          supabase_db_Seaclouds_management_system \
//          psql -U postgres -v ON_ERROR_STOP=1 < supabase/fixtures/document_profile.sql
//   3. the app on port 3001 against the local stack — a PRODUCTION build is the
//      faithful run (`pnpm --filter @scl/dcs build && pnpm --filter @scl/dcs start`)
//   4. a browser: `pnpm --filter @scl/dcs exec playwright install chromium`
// Then: `pnpm --filter @scl/dcs e2e:status`. Exit code 1 if any check fails.
//
// It creates its own two documents (fixed ids, deleted again at the start and
// the end) so it does not touch the fixture's, and it WRITES to the local
// database — it refuses to run against anything that is not localhost.
// Optional environment: E2E_BASE_URL, E2E_SUPABASE_URL, E2E_ANON_KEY (else
// NEXT_PUBLIC_SUPABASE_ANON_KEY, else apps/dcs/.env.local), E2E_DB_CONTAINER,
// E2E_SHOTS (screenshot directory, default: the OS temp dir).
/* global document, window, MutationObserver */
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
const M_DOC = 'f7000000-0000-4000-8000-000000000001' // the ladder + revision status + Approve + Void walkthrough
const M_DOC2 = 'f7000000-0000-4000-8000-000000000002' // RED proofs only, kept apart so they never race the walkthrough
const MY_DOCS = [M_DOC, M_DOC2]
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
const psql = (sql) => execSync(`docker exec -i ${DB_CONTAINER} psql -U postgres -tA`, { input: sql }).toString().trim()

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

const shot = (page, name, options = {}) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), caret: 'initial', ...options })

/** A password-grant token (aal1). */
async function accessToken(email) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  })
  return r.json()
}

/**
 * An aal2 token, through the REAL MFA REST endpoints (challenge + verify) —
 * no browser, so a RED proof can hit PostgREST directly as a DC who has
 * completed the second factor, the same session shape the app itself gets
 * after /mfa.
 */
async function aal2AccessToken(email) {
  const login = await accessToken(email)
  const factorId = login.user.factors[0].id
  const challenge = await fetch(`${API}/auth/v1/factors/${factorId}/challenge`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${login.access_token}`, 'content-type': 'application/json' },
    body: '{}',
  }).then((r) => r.json())
  const verify = await fetch(`${API}/auth/v1/factors/${factorId}/verify`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${login.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ challenge_id: challenge.id, code: totp() }),
  }).then((r) => r.json())
  return verify.access_token
}

// ---------------------------------------------------------------- setup
const dict = (type, code) => psql(`select id from dcs.dictionaries where dict_type = '${type}' and code = '${code}'`)
const STATUS = Object.fromEntries(
  ['NOT_STARTED', 'STARTED', 'IDC', 'IFR', 'RETCOM', 'IFC', 'VOID'].map((c) => [c, dict('workflow_status', c)]),
)
if (!psql(`select 1 from auth.users where email = 'dc.profile@local.test'`)) {
  throw new Error('Fixture not loaded: no dc.profile@local.test. See the prerequisites at the top of this file.')
}

// A locked revision (Approve, in part (c) below) refuses DELETE unconditionally
// (forbid_change_of_locked_revision, 1b.10 — "DELETE is refused always", no
// import_mode bypass). Cleaning up this script's OWN disposable fixture rows
// between runs therefore needs the one break-glass the migration itself names
// as acceptable: the table owner disabling the trigger for a deliberate,
// visible moment, as postgres, never as a session with real privileges. Never
// do this to touch a real row — the trigger's whole point is that nothing
// else may.
const docIds = MY_DOCS.map((d) => `'${d}'`).join(',')
const clean = () => {
  const revIds = psql(`select id from dcs.revisions where document_id in (${docIds})`)
    .split('\n')
    .filter(Boolean)
  const revIdList = (revIds.length ? revIds : ['00000000-0000-0000-0000-000000000000']).map((id) => `'${id}'`).join(',')
  psql(`
    alter table dcs.revisions disable trigger revisions_assert_not_locked;
    alter table dcs.files disable trigger files_assert_revision_not_locked;
    delete from dcs.documents where id in (${docIds});
    alter table dcs.revisions enable trigger revisions_assert_not_locked;
    alter table dcs.files enable trigger files_assert_revision_not_locked;
    delete from public.audit_log
     where (table_name = 'dcs.documents' and record_id in (${docIds}))
        or (table_name = 'dcs.revisions' and record_id in (${revIdList}));
  `)
}
clean()
psql(`
  insert into dcs.documents (id, project_id, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id)
  select v.id, '${PEJ}', v.title,
         (select id from dcs.dictionaries where dict_type = 'doc_type' and code = 'RA'),
         (select id from dcs.dictionaries where dict_type = 'discipline' and code = 'A00'),
         (select id from dcs.dictionaries where dict_type = 'area' and code = '00'),
         (select id from dcs.dictionaries where dict_type = 'language' and code = 'EN'),
         '${STATUS.NOT_STARTED}'
    from (values
      ('${M_DOC}'::uuid, 'E2E 1b.11 manual status ladder'),
      ('${M_DOC2}'::uuid, 'E2E 1b.11 RED proofs')
    ) as v(id, title);
`)

const docStatus = (doc) =>
  psql(`select s.code from dcs.documents d join dcs.dictionaries s on s.id = d.workflow_status_id where d.id = '${doc}'`)
const revStatus = (doc) =>
  psql(
    `select s.code from dcs.revisions r join dcs.dictionaries s on s.id = r.status_id where r.document_id = '${doc}' order by r.created_at desc limit 1`,
  )
// coalesce(): old_value/new_value is SQL NULL for a value that was/became
// absent (the trigger's own convention, public.audit_trigger()) — void_reason's
// old_value on entering Void is exactly that, and `||` with a NULL operand
// yields NULL for the WHOLE concatenation, silently dropping the row from the
// unaligned psql output. Caught by this script's first run: the Void row
// printed as a blank line and the audit assertion below read "(none)".
const documentFieldAudit = (doc) =>
  psql(
    `select occurred_at || '|' || field_name || '|' || coalesce(old_value::text, '<null>') || '|' || coalesce(new_value::text, '<null>')
       from public.audit_log
      where table_name = 'dcs.documents' and record_id = '${doc}' and field_name in ('workflow_status_id', 'void_reason')
      order by occurred_at`,
  )

/**
 * Arms a MutationObserver in the page (same pattern as revision-files.mjs's armSampler, DCS
 * 1b.09, and new-revision.mjs's, DCS 1b.08b). From now until readSamples(), every DOM change
 * records whether an in-progress indicator is on screen (the dialog's spinner, "Approving…" /
 * "Voiding…") and whether `targetText` is already visible in the body — proof for DCS 1b.08b's
 * scope item 4 (the same close-before-refresh-commits bug found in VoidDocumentDialog and
 * ApproveRevisionButton, fixed with the AddFileDialog pattern): the dialog must not close,
 * leaving neither, between the click and the refreshed page showing the result.
 */
async function armSampler(page, targetText) {
  await page.evaluate((text) => {
    window.__sampler?.disconnect()
    window.__samples = []
    const snap = () => {
      const dlg = document.querySelector('[role=dialog]')
      window.__samples.push({
        open: dlg?.getAttribute('data-state') === 'open',
        indicator: !!document.querySelector('[role=dialog] .animate-spin') || /Approving…|Voiding…/.test(document.body.innerText),
        target: document.body.innerText.includes(text),
      })
    }
    window.__sampler = new MutationObserver(snap)
    window.__sampler.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'data-state'] })
  }, targetText)
}
const readSamples = (page) => page.evaluate(() => window.__samples)
/** The samples between the click (first one with the indicator) and the first one with the target text present, inclusive. */
function fromClickToTarget(samples) {
  const start = samples.findIndex((e) => e.indicator)
  if (start < 0) return []
  const end = samples.findIndex((e, i) => i >= start && e.target)
  return samples.slice(start, end < 0 ? samples.length : end + 1)
}

const browser = await chromium.launch()

// =================================================================
// (a) DC: the status ladder, the revision status control, Approve, Void
// =================================================================
{
  const { ctx, page } = await session(browser, 'dc.profile@local.test')
  const url = `${BASE}/documents/${M_DOC}`
  await toAal2(page, `/documents/${M_DOC}`)
  await go(page, url)

  // Criterion 2 / Scope: the "Manual" marker next to the status control.
  const manualHint = await page.locator('text=Manual — in Phase 2 the workflow engine will set this').count()
  rec('a: the "Manual" marker is shown next to the document status control', manualHint === 1)
  await shot(page, 'status-a1-manual-marker', { fullPage: true })

  // The ladder: NOT_STARTED -> STARTED -> IDC -> IFR -> RETCOM -> IFC.
  const select = page.getByLabel('Workflow status')
  for (const code of ['STARTED', 'IDC', 'IFR', 'RETCOM', 'IFC']) {
    await select.selectOption(STATUS[code])
    await page.getByRole('button', { name: 'Change status' }).click()
    await page.waitForTimeout(600)
    await page.waitForSelector('h1')
    const badge = await page.locator('h1').locator('xpath=../..').locator('span').first().textContent()
    rec(`a: status ladder reaches ${code}`, (badge ?? '').includes(code), badge ?? '')
  }
  rec('a/DB: the document really is IFC after the ladder', docStatus(M_DOC) === 'IFC', docStatus(M_DOC))

  // Criterion 1 — DB proof: the audit log carries every hop, in order, all by the DC.
  const ladder = documentFieldAudit(M_DOC) // reuses the same query shape (field_name filter covers workflow_status_id)
  const hops = ladder.split('\n').filter((l) => l.includes('|workflow_status_id|'))
  rec('a/DB: audit_log carries all five status transitions', hops.length === 5, `${hops.length} rows`)

  // A revision, so the revision status control and Approve have something to act on.
  await page.getByRole('button', { name: 'New Revision' }).click()
  await page.waitForSelector('text=New revision')
  await page.locator('#revision-step').selectOption({ label: 'IFC — Issued for Construction' })
  await page.locator('#revision-date').fill('2026-09-22')
  await page.getByRole('button', { name: 'Create revision' }).click()
  await page.waitForTimeout(1000)
  await page.waitForSelector('h1')
  rec('a/DB: the new revision is IFC', revStatus(M_DOC) === 'IFC', revStatus(M_DOC))

  await ctx.close()
}

// =================================================================
// (b) A non-DC seed account: no status, Void or Approve control at all —
//     not merely disabled — even though the state (a current revision on a
//     final step, not yet locked) would otherwise make Approve reachable.
// =================================================================
{
  const { ctx, page } = await session(browser, 'orig.profile@local.test')
  await go(page, `${BASE}/documents/${M_DOC}`)
  rec('b: no document status <select> for a non-DC reader', (await page.getByLabel('Workflow status').count()) === 0)
  rec('b: no "Void document" control for a non-DC reader', (await page.getByRole('button', { name: 'Void document' }).count()) === 0)
  rec('b: no "Approve" control for a non-DC reader, even with a final-step revision available', (await page.getByRole('button', { name: 'Approve' }).count()) === 0)
  await go(page, `${BASE}/documents/${M_DOC}?tab=revisions`)
  rec('b: no revision status <select> for a non-DC reader either', (await page.getByLabel('Revision status').count()) === 0)
  await shot(page, 'status-b1-non-dc-view', { fullPage: true })
  await ctx.close()
}

// =================================================================
// (c) DC again: the revision status control, then Approve, then Void
// =================================================================
{
  const { ctx, page } = await session(browser, 'dc.profile@local.test')
  const url = `${BASE}/documents/${M_DOC}`
  await toAal2(page, `/documents/${M_DOC}`)
  await go(page, url)

  // Revision status control: IFC -> IFR -> back to IFC (Approve needs a final step).
  const revSelect = page.getByLabel('Revision status')
  rec('c: the revision status control is offered to the DC at aal2', (await revSelect.count()) === 1)
  await revSelect.selectOption({ label: 'IFR' })
  await page.getByRole('button', { name: 'Update' }).click()
  await page.waitForTimeout(600)
  rec('c/DB: the revision status control really writes status_id', revStatus(M_DOC) === 'IFR', revStatus(M_DOC))
  await page.getByLabel('Revision status').selectOption({ label: 'IFC' })
  await page.getByRole('button', { name: 'Update' }).click()
  await page.waitForTimeout(600)
  rec('c/DB: and back to IFC', revStatus(M_DOC) === 'IFC', revStatus(M_DOC))

  // Approve.
  const approveBtn = page.locator('aside[aria-label="Current revision"] button', { hasText: 'Approve' })
  await approveBtn.click()
  await page.waitForSelector('text=cannot be undone')
  await armSampler(page, 'Approved')
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  await page.waitForFunction(() => document.body.innerText.includes('Approved'), null, { timeout: 15000 })
  await page.waitForSelector('h1')
  const spanApprove = fromClickToTarget(await readSamples(page))
  const staleApprove = spanApprove.filter((e) => !e.indicator && !e.target)
  rec(
    'c/1b.08b: no sample between the click and the Approved badge shows the dialog gone with neither the "Approving…" indicator nor the badge',
    spanApprove.length > 0 && staleApprove.length === 0,
    staleApprove.length ? `stale samples: ${JSON.stringify(staleApprove.slice(0, 3))}` : `${spanApprove.length} samples from the click to the badge`,
  )
  const panelText = await page.locator('aside[aria-label="Current revision"]').innerText()
  rec('c: the panel shows the Approved badge', panelText.includes('Approved'))
  const addFileBtn = page.locator('aside[aria-label="Current revision"] button', { hasText: 'Add File' })
  rec('c: Add File is disabled on the now-locked revision (files_assert_revision_not_locked)', await addFileBtn.isDisabled())
  await shot(page, 'status-c1-locked-revision', { fullPage: true })

  // Void, with a reason (Criterion 3 / 5: dialog and mandatory reason).
  await page.getByRole('button', { name: 'Void document' }).click()
  await page.waitForSelector('text=takes no further revisions')
  const voidSubmit = page.getByRole('dialog').getByRole('button', { name: 'Void document' })
  rec('d: Void submit starts disabled — no reason typed yet', await voidSubmit.isDisabled())
  await shot(page, 'status-d1-void-dialog-empty-reason')
  const REASON = 'E2E 1b.11: client cancelled the scope after the design freeze'
  await page.getByLabel('Reason').fill(REASON)
  await armSampler(page, REASON)
  await voidSubmit.click()
  await page.waitForFunction((text) => document.body.innerText.includes(text), REASON, { timeout: 15000 })
  await page.waitForSelector('h1')
  const spanVoid = fromClickToTarget(await readSamples(page))
  const staleVoid = spanVoid.filter((e) => !e.indicator && !e.target)
  rec(
    'd/1b.08b: no sample between the click and the stored reason appearing shows the dialog gone with neither the "Voiding…" indicator nor the reason',
    spanVoid.length > 0 && staleVoid.length === 0,
    staleVoid.length ? `stale samples: ${JSON.stringify(staleVoid.slice(0, 3))}` : `${spanVoid.length} samples from the click to the reason`,
  )
  const afterVoid = await page.locator('main').innerText()
  rec('d: the document shows Void and the stored reason', afterVoid.includes(REASON))
  await shot(page, 'status-d2-void-document', { fullPage: true })

  // 2026-09-22 (tj): on a Void document, no role sees a status control — DC included.
  rec('d: the DC sees no status <select> on the now-Void document', (await page.getByLabel('Workflow status').count()) === 0)
  rec('d: the DC sees no "Void document" control either (already Void)', (await page.getByRole('button', { name: 'Void document' }).count()) === 0)
  await ctx.close()
}

// =================================================================
// (e) An admin: also no status control on the Void document — the DB-level
//     "admin may leave Void" fact (enforce_document_void, decision 4) has no
//     UI path (deferred eee).
// =================================================================
{
  const { ctx, page } = await session(browser, 'e2e.admin@local.test')
  const url = `${BASE}/documents/${M_DOC}`
  await toAal2(page, `/documents/${M_DOC}`)
  await go(page, url)
  rec('e: an admin at aal2 ALSO sees no status control on a Void document', (await page.getByLabel('Workflow status').count()) === 0)
  await ctx.close()
}

// =================================================================
// Criterion 2: the audit trail of the Void, read directly.
// =================================================================
{
  const rows = documentFieldAudit(M_DOC)
    .split('\n')
    .filter((l) => l.trim() !== '')
  const reasonRow = rows.find((r) => r.includes('|void_reason|'))
  rec('audit: public.audit_log carries the void_reason row, with the reason', !!reasonRow && reasonRow.includes('client cancelled the scope'), reasonRow ?? '(none)')
  console.log('\n-- audit_log rows for the Void of M_DOC (occurred_at|field_name|old_value|new_value) --')
  for (const row of rows) console.log(row)
}

// =================================================================
// RED proofs, on M_DOC2 (untouched by the walkthrough above), direct against
// PostgREST — bypassing the dialog's client-side validation and the app
// entirely, the same style as new-revision.mjs's RED proofs.
// =================================================================
{
  const dcAal2 = await aal2AccessToken('dc.profile@local.test')
  const origAal1 = (await accessToken('orig.profile@local.test')).access_token

  const patch = (id, body, token) =>
    fetch(`${API}/rest/v1/documents?id=eq.${id}`, {
      method: 'PATCH',
      headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-profile': 'dcs', prefer: 'return=representation' },
      body: JSON.stringify(body),
    })

  // (a) The DC, at aal2, tries to Void with a blank reason — bypassing the
  // dialog's disabled-submit-button entirely. Refused by enforce_document_void
  // (23514), not by the app.
  const before = docStatus(M_DOC2)
  const blankVoid = await patch(M_DOC2, { workflow_status_id: STATUS.VOID, void_reason: '' }, dcAal2)
  const blankVoidBody = await blankVoid.text()
  rec(
    'RED (a): the DC at aal2 Voiding with a blank reason is refused by the database (23514), not the dialog',
    blankVoid.status === 400 && /23514/.test(blankVoidBody) && docStatus(M_DOC2) === before,
    `HTTP ${blankVoid.status} ${blankVoidBody.slice(0, 160)}`,
  )

  // (b) A non-DC (ORIG) tries a plain status change directly. Refused by
  // documents_workflow_status_dc_only (42501) — the same refusal the hidden
  // UI control would have surfaced, had one existed.
  const forgedStatus = await patch(M_DOC2, { workflow_status_id: STATUS.STARTED }, origAal1)
  const forgedStatusBody = await forgedStatus.text()
  rec(
    'RED (b): a non-DC changing the status directly is refused by the database (42501)',
    forgedStatus.status === 403 && /42501/.test(forgedStatusBody) && docStatus(M_DOC2) === before,
    `HTTP ${forgedStatus.status} ${forgedStatusBody.slice(0, 160)}`,
  )
}

rec('no console or hydration errors on any page of any session', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' || '))
clean()
await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${SHOTS}`)
process.exit(failed.length ? 1 : 0)
