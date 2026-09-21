// DCS 1b.07 — browser proof of the document profile, run by hand against the
// LOCAL stack. Not part of CI (docs/03-conventions.md, "Testy przeglądarkowe").
//
// Why a browser script and not a component test: vitest here is node-only, no
// jsdom / RTL, on purpose (DCS 1a.12, vitest.config.ts). What a component does
// is proven through the pure function it calls (lib/document-profile.test.ts);
// what the PAGE does — RLS deciding what three different sessions see, the
// server action writing, the audit row showing up in History — can only be
// proven end to end, and this is that proof.
//
// Prerequisites (all local, see docs/03-conventions.md):
//   1. `supabase start` + `supabase db reset`
//   2. the fixture, loaded by hand:
//        docker exec -i -e PGOPTIONS='-c app.local_fixture=yes' \
//          supabase_db_Seaclouds_management_system \
//          psql -U postgres -v ON_ERROR_STOP=1 < supabase/fixtures/document_profile.sql
//   3. `pnpm --filter @scl/dcs dev` (port 3001) against the local stack
//   4. a browser: `pnpm --filter @scl/dcs exec playwright install chromium`
// Then: `pnpm --filter @scl/dcs e2e:profile`. Exit code 1 if any check fails.
//
// It WRITES to the local database (the DC saves a CPY number, a fixture row is
// pointed at NULL and restored), so it refuses to run against anything that is
// not localhost. Optional environment: E2E_BASE_URL, E2E_SUPABASE_URL,
// E2E_ANON_KEY (else NEXT_PUBLIC_SUPABASE_ANON_KEY, else apps/dcs/.env.local),
// E2E_DB_CONTAINER, E2E_SHOTS (screenshot directory, default: the OS temp dir).
/* global document, window */
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
// E2E_ERROR_CHARS: how much of each console/page error to keep (a dev build prints the hydration diff, which is long).
const ERROR_CHARS = Number(process.env.E2E_ERROR_CHARS ?? 300)
fs.mkdirSync(SHOTS, { recursive: true })

// Fixed ids from supabase/fixtures/document_profile.sql.
const PEJ = '6c0909ce-9b74-4bda-8e92-10811ff5a0fc' // SC2602
const DOC_A = 'f3000000-0000-4000-8000-000000000001' // has a current revision and one file
const DOC_B = 'f3000000-0000-4000-8000-000000000002' // no revision
const REVISION_A = 'f4000000-0000-4000-8000-000000000001'
const DC_ID = 'f1000000-0000-4000-8000-000000000001'
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP'
const RANDOM_UUID = '0d5b7a5e-9f39-4f7c-8a3e-1f2a3b4c5d6e'

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
  // The page's URL is recorded with each error: a rare hydration error is only diagnosable by where it happened.
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(`${email} @ ${page.url()} (after "${results.at(-1)?.name ?? 'start'}"): ${m.text().slice(0, ERROR_CHARS)}`)
  })
  page.on('pageerror', (e) => consoleErrors.push(`${email} @ ${page.url()} (after "${results.at(-1)?.name ?? 'start'}"): pageerror ${e.message.slice(0, ERROR_CHARS)}`))
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
async function toAal2(page, next, landing = '/documents') {
  await page.goto(`${BASE}/mfa?next=${encodeURIComponent(next)}`)
  await page.waitForSelector('input[inputmode=numeric]')
  await page.fill('input[inputmode=numeric]', totp())
  await Promise.all([page.waitForURL((u) => u.pathname.startsWith(landing), { timeout: 15000 }), page.keyboard.press('Enter')])
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

// The number is assigned by the 1b.02 generator when the fixture is loaded, so it is read, not assumed.
const SCL_A = psql(`select scl_doc_number from dcs.documents where id = '${DOC_A}'`)
if (!SCL_A) throw new Error('Fixture not loaded: dcs.documents has no row for DOC_A. See the prerequisites at the top of this file.')
const SCL_A_RE = new RegExp(SCL_A.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'))

const PANEL = 'aside[aria-label="Current revision"]'

// Known starting state, whatever an earlier run left behind. Written as postgres,
// so no DC guard and no session: same as loading the fixture.
psql(`update dcs.documents set cpy_doc_number = null where project_id = '${PEJ}'`)
psql(`update dcs.documents set current_revision_id = '${REVISION_A}' where id = '${DOC_A}'`)

const browser = await chromium.launch()

// ---------------- (a) DC on SC2602, aal1 then aal2 ----------------
{
  const { ctx, page } = await session(browser, 'dc.profile@local.test')

  await go(page, `${BASE}/documents/${DOC_A}`)
  let t = await text(page)
  rec(
    'DC at aal1: CPY field is NOT editable and the reader is told about the second factor',
    (await page.getByLabel('Client (CPY) number').count()) === 0 && /verified second factor/.test(t),
  )
  await shot(page, 'a0-dc-aal1', { fullPage: true })

  await toAal2(page, `/documents/${DOC_A}`)
  t = await text(page)
  rec('a: the profile renders, header carries the SCL number', SCL_A_RE.test(t))
  rec(
    'a: Information shows labels, not uuids',
    /Document type\s*\n?\s*RA — Report/.test(t) && !/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}/.test(t.split('Additional attributes')[0]),
  )
  rec('a: people are shown by name', /Oskar Originator/.test(t) && /Dorota Controller/.test(t))
  rec(
    'a/2: the panel shows the fixture revision (revision, step, reason) and its file',
    /SCL revision\s*\n?\s*A/.test(t) && /IDC/.test(t) && /Issued for internal discipline check/.test(t) && t.includes(`${SCL_A}_A_IDC_2026-09-19_01.docx`),
  )
  rec('a/2: the file row shows kind and size', /original/.test(t) && /2\.3 MB/.test(t))
  rec('a/6: no download LINK in the panel — the Download control is a button that mints a signed URL on click (1b.09)', (await page.locator(`${PANEL} a`).count()) === 0 && (await page.locator(`${PANEL} button[data-download]`).count()) === 1)

  // 1b.07 acceptance 6, as amended by DCS 1b.08 and 1b.09: New Revision and Add File are LIVE dialogs now
  // (the DC at aal2 gets enabled buttons; new-revision.mjs and revision-files.mjs prove what they do), so the
  // disabled actions are the other four — each with its tooltip (title on the wrapper) AND the same sentence
  // printed under the button and tied to it with aria-describedby.
  rec(
    'a/6 (1b.08): New Revision is an ENABLED button for the DC at aal2',
    (await page.locator(`${PANEL} button:has-text("New Revision")`).count()) === 1 &&
      (await page.locator(`${PANEL} button:has-text("New Revision")`).isEnabled()),
  )
  rec(
    'a/6 (1b.09): Add File is an ENABLED button for the DC at aal2 on a document with a current revision',
    (await page.locator(`${PANEL} button:has-text("Add File")`).count()) === 1 &&
      (await page.locator(`${PANEL} button:has-text("Add File")`).isEnabled()),
  )
  const actions = await page.locator(`${PANEL} li:has(span[title])`).evaluateAll((items) =>
    items.map((li) => {
      const button = li.querySelector('button')
      const caption = li.querySelector('p')
      return {
        label: button?.textContent?.trim(),
        disabled: button?.disabled === true,
        title: li.querySelector('span[title]')?.getAttribute('title'),
        caption: caption?.textContent?.trim(),
        described: button?.getAttribute('aria-describedby') === caption?.id,
      }
    }),
  )
  const expected = [
    ['Distribute for IDC', 'Phase 2/3'],
    ['Initiate Review', 'Phase 2/3'],
    ['Initiate Approval', 'Phase 2/3'],
    ['Create Transmittal', 'Phase 2/3'],
  ]
  rec(
    'a/6: four disabled actions, each with its tooltip, its caption and aria-describedby',
    actions.length === 4 &&
      expected.every(([label, hint], i) => {
        const a = actions[i]
        return a.label === label && a.disabled && a.title === hint && a.caption === hint && a.described
      }),
    actions.map((a) => `${a.label}: ${a.title}`).join(' | '),
  )
  await page.locator(PANEL).screenshot({ path: path.join(SHOTS, 'a6-panel-actions.png') })

  rec('a: the CPY field is EDITABLE for the project DC at aal2', (await page.getByLabel('Client (CPY) number').count()) === 1)
  await shot(page, 'a1-dc-aal2-information', { fullPage: true })

  await page.getByText('Additional attributes').click()
  await shot(page, 'a2-dc-additional-attributes', { fullPage: true })

  // Write through setCpyNumber.
  const before = psql(`select coalesce(cpy_doc_number, '<null>') from dcs.documents where id = '${DOC_A}'`)
  await page.getByLabel('Client (CPY) number').fill('CPY-TEST-0042')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForFunction(() => !document.body.innerText.includes('Saving…'), null, { timeout: 15000 })
  await page.waitForTimeout(1500)
  const after = psql(`select cpy_doc_number from dcs.documents where id = '${DOC_A}'`)
  rec('a/3: the CPY number is saved through the action', after === 'CPY-TEST-0042', `${before} -> ${after}`)
  const audited = psql(
    `select count(*) from public.audit_log where table_name = 'dcs.documents' and record_id = '${DOC_A}' and field_name = 'cpy_doc_number' and new_value = '"CPY-TEST-0042"'::jsonb and user_id = '${DC_ID}'`,
  )
  rec('a/3: an audit_log row was written by the DC (dcs.documents / cpy_doc_number)', Number(audited) >= 1, `rows: ${audited}`)

  // History WITHOUT a manual reload: the action's revalidatePath + router.refresh must have refreshed it.
  await page.getByRole('tab', { name: 'History' }).click()
  t = await text(page)
  rec(
    'a/3+4: History lists the CPY change without a reload (cpy_doc_number, — → CPY-TEST-0042, by name)',
    /cpy_doc_number/.test(t) && /CPY-TEST-0042/.test(t) && /Dorota Controller/.test(t),
  )
  rec('a/4: History also lists the fixture rows written without a session', /System \(no session\)/.test(t) && /Document created/.test(t) && /Revision created/.test(t))
  await shot(page, 'a3-dc-history', { fullPage: true })

  // A number another document already holds: refused in a sentence, value unchanged.
  await page.getByRole('tab', { name: 'Information' }).click()
  psql(`update dcs.documents set cpy_doc_number = 'CPY-TAKEN-1' where id = '${DOC_B}'`)
  await page.getByLabel('Client (CPY) number').fill('CPY-TAKEN-1')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForSelector('form [role=alert]', { timeout: 10000 })
  rec(
    'a: a duplicate CPY number is refused with a sentence and the stored value is unchanged',
    /already has this CPY number/.test(await page.locator('form [role=alert]').innerText()) &&
      psql(`select cpy_doc_number from dcs.documents where id = '${DOC_A}'`) === 'CPY-TEST-0042',
  )
  await shot(page, 'a3b-dc-duplicate-refused', { fullPage: true })
  psql(`update dcs.documents set cpy_doc_number = null where id = '${DOC_B}'`)

  // Revisions is a real tab since 1b.08 (new-revision.mjs); these four are still placeholders.
  for (const [name, needle] of [
    ['Plan', 'Phase 2'],
    ['Comments', 'DCS 2.09 · Phase 2'],
    ['References', 'no task number yet'],
    ['Transmittals', 'Phase 3'],
  ]) {
    await page.getByRole('tab', { name }).click()
    rec(`a: placeholder tab ${name} says what lands there ("${needle}")`, (await text(page)).includes(needle))
  }

  await go(page, `${BASE}/documents/${DOC_B}`)
  rec('a/2: a document without a revision shows "No revision yet"', /No revision yet/.test(await text(page)))
  rec(
    'a/2 (1b.09): on a document without a revision Add File is disabled and says to issue one first',
    (await page.locator(`${PANEL} button:has-text("Add File")`).isDisabled()) && /Issue the first revision/.test(await page.locator('#panel-action-add-file-hint').innerText()),
  )
  await shot(page, 'a4-dc-no-revision', { fullPage: true })

  // RED PROOF 3: point the fixture document at NULL, reload, restore.
  psql(`update dcs.documents set current_revision_id = null where id = '${DOC_A}'`)
  const nullRevision = await go(page, `${BASE}/documents/${DOC_A}`)
  t = await text(page)
  rec(
    'RED 3: current_revision_id = NULL -> "No revision yet", no runtime error',
    nullRevision.status() === 200 && /No revision yet/.test(t) && !/Application error|Unhandled/.test(t),
  )
  await shot(page, 'r3-null-current-revision', { fullPage: true })
  psql(`update dcs.documents set current_revision_id = '${REVISION_A}' where id = '${DOC_A}'`)
  await go(page, `${BASE}/documents/${DOC_A}`)
  rec('RED 3: restored, the panel shows the revision again', /SCL revision/.test(await text(page)))

  // RED PROOF 2: an id that is not there, and one that is not even a uuid -> the 404 page.
  // The HTTP status is PINNED at 404 (DCS 1b.07b). While (app)/loading.tsx existed the shell was
  // streamed before notFound() ran and the same request answered 200 (deferred-tasks vv, zz);
  // the boundary is gone, and this is what stops it coming back unnoticed.
  for (const id of [RANDOM_UUID, 'abc']) {
    const response = await go(page, `${BASE}/documents/${id}`)
    const body = await text(page)
    rec(
      `RED 2: /documents/${id} shows the 404 page and answers HTTP 404`,
      /could not be found/i.test(body) && !/SC2602/.test(body) && response.status() === 404,
      `HTTP ${response.status()}`,
    )
  }
  {
    const response = await go(page, `${BASE}/projects/${RANDOM_UUID}/documents`)
    rec(
      'RED 2: /projects/<unknown uuid>/documents shows the 404 page and answers HTTP 404',
      /could not be found/i.test(await text(page)) && response.status() === 404,
      `HTTP ${response.status()}`,
    )
  }
  await go(page, `${BASE}/documents/${RANDOM_UUID}`)
  await shot(page, 'r2-random-uuid-404')

  // Narrow viewport: the two columns stack, nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 900 })
  await go(page, `${BASE}/documents/${DOC_A}`)
  rec('a: at 390px wide the page has no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await shot(page, 'a5-dc-mobile', { fullPage: true })
  await ctx.close()
}

// ---------------- (b) plain ORIG member of SC2602 ----------------
{
  const { ctx, page } = await session(browser, 'orig.profile@local.test')

  // Acceptance 1: the SCL-number link on /mdr leads to the profile.
  await go(page, `${BASE}/mdr`)
  await shot(page, 'l1-mdr-register')
  const mdrLink = page.locator('main table a', { hasText: SCL_A }).first()
  const mdrHref = await mdrLink.getAttribute('href')
  await Promise.all([page.waitForURL((u) => u.pathname === `/documents/${DOC_A}`, { timeout: 15000 }), mdrLink.click()])
  await page.waitForSelector('h1')
  rec('1: the SCL number on /mdr links to /documents/[documentId] and the profile opens', mdrHref === `/documents/${DOC_A}` && SCL_A_RE.test(await page.locator('h1').innerText()), `href ${mdrHref}`)

  // Acceptance 1: the row link on /projects/[id]/documents.
  await go(page, `${BASE}/projects/${PEJ}/documents`)
  await shot(page, 'l2-project-documents')
  const listLink = page.locator('main a', { hasText: SCL_A }).first()
  const listHref = await listLink.getAttribute('href')
  await Promise.all([page.waitForURL((u) => u.pathname === `/documents/${DOC_A}`, { timeout: 15000 }), listLink.click()])
  await page.waitForSelector('h1')
  rec('1: the row link on /projects/[id]/documents opens the profile', listHref === `/documents/${DOC_A}` && SCL_A_RE.test(await page.locator('h1').innerText()), `href ${listHref}`)

  await go(page, `${BASE}/documents/${DOC_A}`)
  let t = await text(page)
  rec('b: the profile renders for the ORIG member', SCL_A_RE.test(t))
  rec(
    'b/3: CPY is read-only for ORIG, with the reason',
    (await page.getByLabel('Client (CPY) number').count()) === 0 && /Only the project.s Document Controller can set this number/.test(t),
  )
  rec('b: the CPY value is visible read-only', /CPY-TEST-0042/.test(t))
  rec('b/2: the panel shows the revision and the file', /SCL revision/.test(t) && /original/.test(t))
  await shot(page, 'b1-orig-information', { fullPage: true })

  await page.getByRole('tab', { name: 'History' }).click()
  t = await text(page)
  rec('b/4: History shows the RLS-aware empty state for a plain member', /No history visible/.test(t) && /may exist/.test(t) && /administrators/.test(t))
  await shot(page, 'b2-orig-history-empty', { fullPage: true })
  await ctx.close()

  // RED PROOF 1: the ORIG session writes the CPY number directly, exactly as PostgREST would receive it.
  const jwt = await accessToken('orig.profile@local.test')
  const stored = () => psql(`select cpy_doc_number from dcs.documents where id = '${DOC_A}'`)
  const before = stored()
  const response = await fetch(`${API}/rest/v1/documents?id=eq.${DOC_A}`, {
    method: 'PATCH',
    headers: { apikey: ANON, authorization: `Bearer ${jwt}`, 'content-type': 'application/json', 'content-profile': 'dcs', prefer: 'return=representation' },
    body: JSON.stringify({ cpy_doc_number: 'CPY-FORGED' }),
  })
  const body = await response.text()
  rec(
    'RED 1: ORIG writing cpy_doc_number directly is refused by the trigger (42501) and the value is unchanged',
    response.status === 403 && /42501/.test(body) && stored() === before,
    `HTTP ${response.status}, ${before} -> ${stored()}`,
  )
}

// ---------------- (c) a user who is not on SC2602 ----------------
{
  const { ctx, page } = await session(browser, 'outsider.profile@local.test')
  await go(page, `${BASE}/documents/${DOC_A}`)
  const t = await text(page)
  rec(
    'c/5: a non-member gets the 404 page — no document, no stack trace, no empty page',
    /could not be found/i.test(t) && !SCL_A_RE.test(t) && !/at .*\(.*:\d+:\d+\)|Error:/.test(t),
  )
  await shot(page, 'c1-outsider-404', { fullPage: true })
  await ctx.close()
}

// ---------------- (d) the admin ----------------
{
  const { ctx, page } = await session(browser, 'tjezionekspam@gmail.com')
  await go(page, `${BASE}/documents/${DOC_A}`)
  await page.getByRole('tab', { name: 'History' }).click()
  const t = await text(page)
  rec('4: an admin sees the History entries too', /cpy_doc_number/.test(t) && /CPY-TEST-0042/.test(t))
  await shot(page, 'd1-admin-history', { fullPage: true })
  await ctx.close()
}

// ---------------- (e) the fourth notFound() route, which needs an admin at aal2 (DCS 1b.07b) ----------------
// /admin/* asks an admin for a second factor (proxy.ts), and the seed's own admin has none; the fixture's
// e2e.admin@local.test does. Same pinned status as the profile routes above.
{
  const { ctx, page } = await session(browser, 'e2e.admin@local.test')
  await toAal2(page, `/admin/projects/${PEJ}`, '/admin')
  const response = await go(page, `${BASE}/admin/projects/${RANDOM_UUID}`)
  rec(
    'RED 2: /admin/projects/<unknown uuid> (admin, aal2) shows the 404 page and answers HTTP 404',
    /could not be found/i.test(await text(page)) && response.status() === 404,
    `HTTP ${response.status()}`,
  )
  await ctx.close()
}

rec('no console or hydration errors on any page of any session', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' || '))
await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${SHOTS}`)
process.exit(failed.length ? 1 : 0)
