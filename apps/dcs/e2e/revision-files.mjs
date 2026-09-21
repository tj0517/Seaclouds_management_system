// DCS 1b.09 (PR 2) — browser proof of files on a revision: upload through the
// Add File dialog, the generated name, the file list, the Download button, the
// expired URL, and the refusals. Run by hand against the LOCAL stack, on a
// PRODUCTION build. Not part of CI (docs/03-conventions.md, "Testy przeglądarkowe").
//
// What is proven where:
//   - the name rule and the parsing        lib/files.test.ts (vitest)
//   - who may upload / read bytes           supabase/tests/storage_dcs_documents.test.sql (pgTAP)
//   - what the PAGE does with all of it     this file
// Every refusal below is asserted TWICE: through the screen (the sentence the
// button shows) and by a read made straight at the storage-api or PostgREST as
// that user, because a hidden button is not the enforcement.
//
// Prerequisites (all local; docs/03-conventions.md, "Fixtury lokalne i testy
// przeglądarkowe"):
//   1. `supabase start` + `supabase db reset`, then the fixture
//      (supabase/fixtures/document_profile.sql — it also creates the two 1b.09
//      users: tes.profile@local.test and view.profile@local.test).
//   2. a production build of apps/dcs on Node 20: `pnpm --filter @scl/dcs exec next
//      build`, then `pnpm --filter @scl/dcs exec next start --port 3001`.
//   3. Chromium: `pnpm --filter @scl/dcs exec playwright install chromium`.
// Then: `pnpm --filter @scl/dcs e2e:files`. Exit code 1 if any check fails.
//
// It creates its own document (fixed id) with two revisions, and deletes the
// document AND this folder's storage.objects rows at the start and at the end
// (the storage-api's own delete guard is stood aside for that one statement,
// local only). The bytes on the local storage volume are overwritten on the
// next run. It WRITES to the local database and refuses any host but localhost.
//
// Section (h) (PR #81 review round 3) is the upload UX: a double click stores
// exactly one object and one row; a 50 MiB file shows a progress bar that
// reaches 100% while the submit button is disabled and reads "Adding…"; a PUT
// that never gets an answer gives way to a sentence and can be retried. The
// 50 MiB file is written to the OS temp directory and removed at the end.
//
// Optional environment: E2E_BASE_URL, E2E_SUPABASE_URL, E2E_ANON_KEY, E2E_DB_CONTAINER,
// E2E_SHOTS, E2E_SKIP_EXPIRY=1 (skips the 61 s wait for the expired-URL check).
/* global document, window, MutationObserver */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { API, BASE, IDS, accessToken, anonKey, guardLocal, go, holds, launch, psql, session, shot, toAal2 } from './support.mjs'

guardLocal()
const ANON = anonKey()

const results = []
const errors = []
const rec = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const text = async (page) => page.locator('main').innerText().catch(() => page.locator('body').innerText())
const PANEL = 'aside[aria-label="Current revision"]'
const todayUtc = new Date().toISOString().slice(0, 10)

// ---------------------------------------------------------------- setup
const DOC = 'f6000000-0000-4000-8000-000000000001'
const REV_A = 'f6000000-0000-4000-8000-0000000000a1' // revision_date 2026-09-19 — the date in the name
const REV_B = 'f6000000-0000-4000-8000-0000000000b1' // revision_date NULL — the upload date, UTC
if (!psql(`select 1 from auth.users where email = 'view.profile@local.test'`)) {
  throw new Error('Fixture not loaded (or an older one): no view.profile@local.test. Reload supabase/fixtures/document_profile.sql.')
}
const dict = (type, code) => psql(`select id from dcs.dictionaries where dict_type = '${type}' and code = '${code}'`)

function clean() {
  const folder = psql(`select 'SC2602/' || scl_doc_number || '/' from dcs.documents where id = '${DOC}'`)
  if (folder) {
    psql(`set storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id = 'dcs-documents' and name like '${folder}%'`)
  }
  psql(`delete from dcs.documents where id = '${DOC}'`)
}
clean()
// Written as postgres, so no session: the generator numbers the document; the
// codes are supplied (sessionless inserts bypass the DC check, as the fixture does).
psql(`
  insert into dcs.documents (id, project_id, title, doc_type_id, discipline_id, area_id, language_id, workflow_status_id, originator_id)
  values ('${DOC}', '${IDS.PEJ}', 'E2E 1b.09 files', '${dict('doc_type', 'RA')}', '${dict('discipline', 'A00')}', '${dict('area', '00')}',
          '${dict('language', 'EN')}', '${dict('workflow_status', 'NOT_STARTED')}', '${IDS.ORIG}');
  insert into dcs.revisions (id, document_id, project_id, scl_revision, step_id, status_id, revision_date, created_by)
  values ('${REV_A}', '${DOC}', '${IDS.PEJ}', 'A', '${dict('workflow_step', 'IDC')}', '${dict('workflow_status', 'IDC')}', date '2026-09-19', '${IDS.ORIG}');
  insert into dcs.revisions (id, document_id, project_id, scl_revision, step_id, status_id, revision_date, created_by)
  values ('${REV_B}', '${DOC}', '${IDS.PEJ}', 'B', '${dict('workflow_step', 'IDC')}', '${dict('workflow_status', 'IDC')}', null, '${IDS.ORIG}');
`)
const SCL = psql(`select scl_doc_number from dcs.documents where id = '${DOC}'`)
const FOLDER_A = `SC2602/${SCL}/A`
const FOLDER_B = `SC2602/${SCL}/B`
rec('setup: the document has two revisions and B is current (promote trigger)', psql(`select scl_revision from dcs.revisions where id = (select current_revision_id from dcs.documents where id = '${DOC}')`) === 'B')

const fileRow = (name) =>
  psql(
    `select file_name || '|' || original_name || '|' || storage_path || '|' || coalesce(size_bytes::text, '') || '|' || coalesce(mime_type, '') || '|' || file_kind || '|' || sort_order || '|' || coalesce(uploaded_by::text, '')
       from dcs.files where file_name = '${name}'`,
  )
const objectRow = (path) => psql(`select name || '|' || coalesce(metadata->>'size', '') from storage.objects where bucket_id = 'dcs-documents' and name = '${path}'`)

/**
 * Uploads through the dialog opened by `trigger`, and waits until the refreshed
 * file list carries `expectedName` — the server-rendered row, not the cleared
 * spinner, is what "done" means (docs/03-conventions.md).
 */
async function uploadVia(page, trigger, { name, mimeType, content, kind, filePath }, expectedName, { submit, timeout = 15000 } = {}) {
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  // A path is handed to the browser as-is (a 50 MiB file is not pushed through the protocol as a buffer).
  await dialog.locator('input[type=file]').setInputFiles(filePath ?? { name, mimeType, buffer: Buffer.from(content) })
  if (kind) await dialog.locator('#add-file-kind').selectOption(kind)
  if (submit) await submit(dialog)
  else await dialog.getByRole('button', { name: 'Upload' }).click()
  const landed = await holds(page, (n) => !!document.querySelector(`[data-file-row="${n}"]`), expectedName, timeout)
  const pendingGone = landed && (await holds(page, () => !document.querySelector('.animate-spin') && !/Adding…/.test(document.body.innerText), null, 5000))
  return { landed, pendingGone, alert: landed ? '' : await dialog.locator('[role=alert]').innerText().catch(() => '') }
}

/** Clicks Download and returns the browser's download (or null) plus the page's alert text. */
async function download(page, name) {
  const button = page.locator(`button[data-download="${name}"]`).first()
  const dl = await Promise.all([page.waitForEvent('download', { timeout: 10000 }).catch(() => null), button.click()]).then(([d]) => d)
  const alert = dl ? '' : await page.locator('[role=alert]').first().innerText().catch(() => '')
  return { dl, alert }
}

const signDownload = (jwt, path) =>
  fetch(`${API}/storage/v1/object/sign/dcs-documents/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: 60 }),
  })
const signUpload = (jwt, path) =>
  fetch(`${API}/storage/v1/object/upload/sign/dcs-documents/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${jwt}` },
  })

const browser = await launch()
let firstSignedUrl = null
let firstSignedAt = 0

// =================================================================
// (a) The Originator: uploads through the tab row and the panel, downloads
// =================================================================
{
  const { ctx, page } = await session(browser, 'orig.profile@local.test', errors)
  await go(page, `${BASE}/documents/${DOC}?tab=revisions&open=${REV_B}`)
  rec('a: the Revisions tab opens with B expanded and an Add File button in the row', (await page.locator('[data-revision-files="B"] button[data-add-file="B"]').count()) === 1)

  // ---- 1. a name with spaces, brackets and an upper-case extension ----
  const NAME_1 = `${SCL}_B_IDC_${todayUtc}_01.pdf`
  const up1 = await uploadVia(page, page.locator('[data-revision-files="B"] button[data-add-file="B"]'), { name: 'Survey Report FINAL (v2).PDF', mimeType: 'application/pdf', content: 'hello-pdf-bytes', kind: 'original' }, NAME_1)
  rec('a/1: the upload lands: the refreshed list in the expanded row carries the generated name, and pending is gone', up1.landed && up1.pendingGone, up1.alert)
  await shot(page, 'files-a1-uploaded-row', { fullPage: true })
  const row1 = fileRow(NAME_1)
  rec(
    'a/1: the stored row: file_name by the rule (revision B has no date -> upload date in UTC, NN 01, ext lower-cased), original_name = the user’s name, path under SC2602/<doc>/B/, size, mime, kind, sort_order 1, uploaded_by = the Originator',
    row1 === `${NAME_1}|Survey Report FINAL (v2).PDF|${FOLDER_B}/${NAME_1}|15|application/pdf|original|1|${IDS.ORIG}`,
    row1,
  )
  rec('a/1: the object exists in the bucket at that key with the bytes', objectRow(`${FOLDER_B}/${NAME_1}`) === `${FOLDER_B}/${NAME_1}|15`, objectRow(`${FOLDER_B}/${NAME_1}`))
  // The current revision's files are listed twice (the expanded row and the panel), so the row is scoped.
  const rowText = await page.locator(`[data-revision-files="B"] [data-file-row="${NAME_1}"]`).innerText()
  rec('a/1: the row shows the generated name, the uploaded name as a hint, the kind and the size', rowText.includes(NAME_1) && /Uploaded as Survey Report FINAL \(v2\)\.PDF/.test(rowText) && /original/.test(rowText) && /15 B/.test(rowText))

  // ---- 2. non-ASCII in the name, a different kind: NN rolls to 02 ----
  const NAME_2 = `${SCL}_B_IDC_${todayUtc}_02.pdf`
  const up2 = await uploadVia(page, page.locator('[data-revision-files="B"] button[data-add-file="B"]'), { name: 'Zażółć gęślą jaźń.pdf', mimeType: 'application/pdf', content: 'second', kind: 'attachment' }, NAME_2)
  rec('a/2: a second file on the same revision gets NN 02; the non-ASCII name stays in original_name only', up2.landed && fileRow(NAME_2) === `${NAME_2}|Zażółć gęślą jaźń.pdf|${FOLDER_B}/${NAME_2}|6|application/pdf|attachment|2|${IDS.ORIG}`, fileRow(NAME_2))

  // ---- 3. through the panel (current revision = B): NN 03, no extension ----
  const NAME_3 = `${SCL}_B_IDC_${todayUtc}_03`
  const up3 = await uploadVia(page, page.locator(`${PANEL} button[data-add-file="B"]`), { name: 'README', mimeType: 'text/plain', content: 'no-ext', kind: 'comment_sheet' }, NAME_3)
  rec('a/3: the panel’s Add File targets the current revision: NN 03, and a name without an extension gets none', up3.landed && fileRow(NAME_3) === `${NAME_3}|README|${FOLDER_B}/${NAME_3}|6|text/plain|comment_sheet|3|${IDS.ORIG}`, fileRow(NAME_3))
  rec('a/3: the panel lists the three files of the current revision', (await page.locator(`${PANEL} [data-file-row]`).count()) === 3)
  await shot(page, 'files-a3-panel-three-files', { fullPage: true })

  // ---- 4. revision A (dated): the date in the name is the revision’s, not today’s ----
  await page.locator('[data-revision-row="A"] button[aria-expanded]').click()
  const NAME_A1 = `${SCL}_A_IDC_2026-09-19_01.dwg`
  const upA = await uploadVia(page, page.locator('[data-revision-files="A"] button[data-add-file="A"]'), { name: 'model.DWG', mimeType: 'application/octet-stream', content: 'dwg', kind: 'original' }, NAME_A1)
  rec('a/4: on a dated revision the name carries revision_date (2026-09-19), and NN restarts at 01 per revision', upA.landed && fileRow(NAME_A1) === `${NAME_A1}|model.DWG|${FOLDER_A}/${NAME_A1}|3|application/octet-stream|original|1|${IDS.ORIG}`, fileRow(NAME_A1))

  // ---- 5. download: a real browser download under the generated name, the page stays usable ----
  const { dl, alert } = await download(page, NAME_1)
  rec('a/5: Download starts a browser download named by the generated name (Content-Disposition from the signed URL)', dl !== null && dl.suggestedFilename() === NAME_1, alert || dl?.suggestedFilename())
  if (dl) {
    const saved = await dl.path()
    const { readFileSync } = await import('node:fs')
    rec('a/5: the bytes are the ones uploaded', readFileSync(saved, 'utf8') === 'hello-pdf-bytes')
    firstSignedUrl = dl.url()
    firstSignedAt = Date.now()
    const probe = await fetch(firstSignedUrl)
    rec('a/5: the signed URL answers 200 right away, without any session (it carries its own token)', probe.status === 200, `HTTP ${probe.status}`)
  }
  await page.getByRole('tab', { name: 'Information' }).click()
  rec('a/5: after the download the page is still alive (the Information tab switches, the header is there)', /Document type/.test(await text(page)) && (await page.locator('h1').innerText()).includes(SCL))
  await page.getByRole('tab', { name: 'Revisions' }).click()
  rec('a/5: the Download button is enabled again (no spinner left behind)', await holds(page, (n) => { const b = document.querySelector(`button[data-download="${n}"]`); return !!b && !b.disabled }, NAME_1, 5000))

  // ---- 6. the fixture row whose object was never uploaded: the one sentence ----
  await go(page, `${BASE}/documents/${IDS.DOC_A}`)
  const fixtureName = psql(`select file_name from dcs.files where id = 'f5000000-0000-4000-8000-000000000001'`)
  const missing = await download(page, fixtureName)
  rec('a/6: a row whose object is not in the bucket gets the "not available" sentence, no download, no crash', missing.dl === null && /not available to you/.test(missing.alert), missing.alert)
  await shot(page, 'files-a6-missing-object')

  // ---- 7. no public URL to the object ----
  const pub = await fetch(`${API}/storage/v1/object/public/dcs-documents/${FOLDER_B}/${NAME_1}`)
  rec('a/7: the bucket is private — the public URL of the object does not serve it', pub.status !== 200, `HTTP ${pub.status}`)
  await ctx.close()
}

// =================================================================
// (b) A viewer: downloads, cannot upload
// =================================================================
{
  const { ctx, page } = await session(browser, 'view.profile@local.test', errors)
  await go(page, `${BASE}/documents/${DOC}?tab=revisions&open=${REV_B}`)
  const NAME_1 = `${SCL}_B_IDC_${todayUtc}_01.pdf`
  rec('b: a VIEW of the project opens the profile and sees the file rows', (await page.locator(`[data-revision-files="B"] [data-file-row="${NAME_1}"]`).count()) === 1)
  const { dl, alert } = await download(page, NAME_1)
  rec('b: a VIEW downloads (any dcs.project_roles row reads bytes — the SELECT policy)', dl !== null && dl.suggestedFilename() === NAME_1, alert)
  rec('b/RED: a VIEW has no Add File dialog — the panel button is disabled with the role sentence, the row shows the sentence and no dialog', (await page.locator(`${PANEL} button:has-text("Add File")`).isDisabled()) && /Only an Originator or the Document Controller/.test(await page.locator('#panel-action-add-file-hint').innerText()) && (await page.locator('[data-revision-files="B"] button[data-add-file]').count()) === 0)
  await shot(page, 'files-b-viewer', { fullPage: true })
  await ctx.close()

  const jwt = await accessToken('view.profile@local.test')
  const signed = await signUpload(jwt, `${FOLDER_B}/${SCL}_B_IDC_${todayUtc}_99.pdf`)
  rec('b/RED (read): the storage-api refuses to sign an upload URL for a VIEW — the INSERT policies, not the hidden button', signed.status !== 200, `HTTP ${signed.status} ${(await signed.text()).slice(0, 100)}`)
}

// =================================================================
// (c) A Timesheet member with no DCS role: metadata yes, bytes no (O-16)
// =================================================================
{
  const { ctx, page } = await session(browser, 'tes.profile@local.test', errors)
  await go(page, `${BASE}/documents/${DOC}?tab=revisions&open=${REV_B}`)
  const NAME_1 = `${SCL}_B_IDC_${todayUtc}_01.pdf`
  rec('c: a TES-assigned member with no DCS role opens the profile and sees the file rows (metadata — is_project_member)', (await page.locator(`[data-revision-files="B"] [data-file-row="${NAME_1}"]`).count()) === 1)
  const { dl, alert } = await download(page, NAME_1)
  rec('c/RED: pressing Download gets the "not available" sentence and no download — the action answers forbidden (O-16)', dl === null && /not available to you/.test(alert), alert)
  rec('c/RED: no Add File for them either', (await page.locator(`${PANEL} button:has-text("Add File")`).isDisabled()) && (await page.locator('[data-revision-files="B"] button[data-add-file]').count()) === 0)
  await shot(page, 'files-c-tes-forbidden', { fullPage: true })
  await ctx.close()

  const jwt = await accessToken('tes.profile@local.test')
  const rows = await fetch(`${API}/rest/v1/files?select=file_name&revision_id=eq.${REV_B}`, { headers: { apikey: ANON, authorization: `Bearer ${jwt}`, 'accept-profile': 'dcs' } })
  const rowsBody = await rows.json()
  rec('c (read): PostgREST returns the dcs.files rows to them — the metadata half of O-16, unchanged', rows.status === 200 && Array.isArray(rowsBody) && rowsBody.length === 3, `HTTP ${rows.status}, ${Array.isArray(rowsBody) ? rowsBody.length : '?'} rows`)
  const signed = await signDownload(jwt, `${FOLDER_B}/${NAME_1}`)
  rec('c/RED (read): the storage-api refuses to sign a download URL for them — the bucket SELECT policy', signed.status !== 200, `HTTP ${signed.status} ${(await signed.text()).slice(0, 100)}`)
}

// =================================================================
// (d) An outsider: nothing, anywhere
// =================================================================
{
  const { ctx, page } = await session(browser, 'outsider.profile@local.test', errors)
  const response = await go(page, `${BASE}/documents/${DOC}`)
  rec('d/RED: an outsider gets the 404 page for the document', response.status() === 404 && /could not be found/i.test(await text(page)))
  await ctx.close()

  const jwt = await accessToken('outsider.profile@local.test')
  const NAME_1 = `${SCL}_B_IDC_${todayUtc}_01.pdf`
  const rows = await fetch(`${API}/rest/v1/files?select=file_name&revision_id=eq.${REV_B}`, { headers: { apikey: ANON, authorization: `Bearer ${jwt}`, 'accept-profile': 'dcs' } })
  const rowsBody = await rows.json()
  rec('d/RED (read): PostgREST returns 0 dcs.files rows to an outsider', rows.status === 200 && Array.isArray(rowsBody) && rowsBody.length === 0, `HTTP ${rows.status}, ${Array.isArray(rowsBody) ? rowsBody.length : '?'} rows`)
  const signed = await signDownload(jwt, `${FOLDER_B}/${NAME_1}`)
  rec('d/RED (read): the storage-api refuses to sign a download URL for an outsider', signed.status !== 200, `HTTP ${signed.status}`)
  const signedUp = await signUpload(jwt, `${FOLDER_B}/${SCL}_B_IDC_${todayUtc}_98.pdf`)
  rec('d/RED (read): …and an upload URL', signedUp.status !== 200, `HTTP ${signedUp.status}`)
}

// =================================================================
// (e) The Document Controller: aal1 cannot, aal2 can
// =================================================================
{
  const { ctx, page } = await session(browser, 'dc.profile@local.test', errors)
  await go(page, `${BASE}/documents/${DOC}`)
  rec('e/RED: a DC at aal1 gets a disabled Add File that asks for the second factor', (await page.locator(`${PANEL} button:has-text("Add File")`).isDisabled()) && /verified second factor/.test(await page.locator('#panel-action-add-file-hint').innerText()))
  const jwt1 = await accessToken('dc.profile@local.test')
  const signed1 = await signUpload(jwt1, `${FOLDER_B}/${SCL}_B_IDC_${todayUtc}_97.pdf`)
  rec('e/RED (read): the storage-api refuses to sign an upload URL for the DC at aal1 (the aal2 condition of the DC policy)', signed1.status !== 200, `HTTP ${signed1.status}`)

  await toAal2(page, `/documents/${DOC}`)
  const NAME_4 = `${SCL}_B_IDC_${todayUtc}_04.pdf`
  const up = await uploadVia(page, page.locator(`${PANEL} button[data-add-file="B"]`), { name: 'dc-upload.pdf', mimeType: 'application/pdf', content: 'dc', kind: 'rendition' }, NAME_4)
  rec('e: at aal2 the DC uploads through the panel: NN 04 on B, kind rendition, uploaded_by = the DC', up.landed && fileRow(NAME_4) === `${NAME_4}|dc-upload.pdf|${FOLDER_B}/${NAME_4}|2|application/pdf|rendition|4|${IDS.DC}`, up.alert || fileRow(NAME_4))
  await shot(page, 'files-e-dc-aal2', { fullPage: true })
  await ctx.close()
}

// =================================================================
// (f) A collision: the same NN computed twice surfaces as a sentence, not a hang
// =================================================================
{
  // An object put in the folder behind the app's back, at the name the next upload will compute (05),
  // with no dcs.files row: the storage listing is part of the NN read, so the app skips to 06 —
  // and a PUT to the taken key, as the storage-api answers it, is a readable 409.
  const jwt = await accessToken('orig.profile@local.test')
  const TAKEN = `${SCL}_B_IDC_${todayUtc}_05.pdf`
  const sign = await (await signUpload(jwt, `${FOLDER_B}/${TAKEN}`)).json()
  // The storage-api answers the sign call with a path relative to its own base.
  const put = await fetch(`${API}/storage/v1${sign.url}`, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'x-upsert': 'false' }, body: 'orphan' })
  rec('f: setup — an orphan object (no row) sits at NN 05', put.status === 200 && objectRow(`${FOLDER_B}/${TAKEN}`) !== '', `HTTP ${put.status}`)
  // The storage-api refuses the taken key when asked to SIGN a second upload URL for it (409 Duplicate), which
  // is where the app's prepare step meets it (mapStorageError -> the collision sentence); a PUT that did get a
  // URL would be refused the same way. Either answer is the 409 the name rule allows for.
  const secondSign = await signUpload(jwt, `${FOLDER_B}/${TAKEN}`)
  const secondBody = await secondSign.text()
  let collision = { status: secondSign.status, body: secondBody }
  if (secondSign.status === 200) {
    const put2 = await fetch(`${API}/storage/v1${JSON.parse(secondBody).url}`, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'x-upsert': 'false' }, body: 'orphan-2' })
    collision = { status: put2.status, body: await put2.text() }
  }
  rec('f/RED (read): a second upload to the taken key is a 409 Duplicate from the storage-api — the collision the name rule allows for', /"409"|already exists|Duplicate/.test(collision.body) || collision.status === 409, `HTTP ${collision.status} ${collision.body.slice(0, 90)}`)

  const { ctx, page } = await session(browser, 'orig.profile@local.test', errors)
  await go(page, `${BASE}/documents/${DOC}?tab=revisions&open=${REV_B}`)
  const NAME_6 = `${SCL}_B_IDC_${todayUtc}_06.pdf`
  const up = await uploadVia(page, page.locator('[data-revision-files="B"] button[data-add-file="B"]'), { name: 'after-orphan.pdf', mimeType: 'application/pdf', content: 'six', kind: 'original' }, NAME_6)
  rec('f: the next upload through the dialog skips the orphaned 05 and lands as 06 — the folder listing counts, not only the rows', up.landed && fileRow(NAME_6).startsWith(`${NAME_6}|after-orphan.pdf|${FOLDER_B}/${NAME_6}|`), up.alert || fileRow(NAME_6))
  await ctx.close()
}

// =================================================================
// (h) The upload UX (PR #81 review round 3): one upload per double click,
//     a progress bar that reaches 100% under a disabled "Adding…" button,
//     and a PUT with no answer that gives way to a sentence
// =================================================================
{
  const { ctx, page } = await session(browser, 'orig.profile@local.test', errors)
  await go(page, `${BASE}/documents/${DOC}?tab=revisions&open=${REV_A}`)
  const trigger = page.locator('[data-revision-files="A"] button[data-add-file="A"]')
  const rowsA = () => Number(psql(`select count(*) from dcs.files where revision_id = '${REV_A}'`))
  const objectsA = () => Number(psql(`select count(*) from storage.objects where bucket_id = 'dcs-documents' and name like '${FOLDER_A}/%'`))
  rec('h: setup — revision A carries one row and one object (a/4)', rowsA() === 1 && objectsA() === 1, `${rowsA()} rows, ${objectsA()} objects`)

  // ---- 1. a real double click on Upload: the second click meets a disabled button ----
  const NAME_A2 = `${SCL}_A_IDC_2026-09-19_02.pdf`
  const big = Buffer.alloc(4 * 1024 * 1024, 1) // 4 MiB: the first upload is still in flight when the second click lands
  const dbl = await uploadVia(page, trigger, { name: 'double-click.pdf', mimeType: 'application/pdf', content: big, kind: 'original' }, NAME_A2, {
    submit: (dialog) => dialog.getByRole('button', { name: 'Upload' }).dblclick(),
  })
  // Give a second upload, had one started, time to finish before counting.
  await page.waitForTimeout(1500)
  rec('h/1: a double click on Upload stores exactly one row and one object (NN 02, no 03)', dbl.landed && dbl.pendingGone && rowsA() === 2 && objectsA() === 2 && fileRow(`${SCL}_A_IDC_2026-09-19_03.pdf`) === '', `${rowsA()} rows, ${objectsA()} objects`)

  // ---- 2. two submits in one task (Enter held down, a flaky trackpad): the latch, not the disabled attribute ----
  // form.requestSubmit() ignores a disabled submit button, so this is the hook's latch alone being tested.
  const NAME_A3 = `${SCL}_A_IDC_2026-09-19_03.pdf`
  const twice = await uploadVia(page, trigger, { name: 'two-submits.pdf', mimeType: 'application/pdf', content: big, kind: 'original' }, NAME_A3, {
    submit: (dialog) => dialog.locator('form').evaluate((form) => { form.requestSubmit(); form.requestSubmit() }),
  })
  await page.waitForTimeout(1500)
  rec('h/2: two synchronous submits store exactly one row and one object (NN 03, no 04) — the single-flight latch', twice.landed && twice.pendingGone && rowsA() === 3 && objectsA() === 3 && fileRow(`${SCL}_A_IDC_2026-09-19_04.pdf`) === '', `${rowsA()} rows, ${objectsA()} objects`)

  // ---- 3. a 50 MiB file: the bar, the percent, the disabled button, the stored row ----
  const LARGE_BYTES = 50 * 1024 * 1024
  const largePath = path.join(os.tmpdir(), 'dcs-e2e-large-upload.bin')
  fs.writeFileSync(largePath, Buffer.alloc(LARGE_BYTES, 7))
  const NAME_A4 = `${SCL}_A_IDC_2026-09-19_04.bin`
  // Every change of the bar (and its appearance) is logged in the page together with what the submit
  // button showed at that moment — a polling loop from here could miss a fast local upload.
  await page.evaluate(() => {
    window.__uploadLog = []
    const snap = () => {
      const dialog = document.querySelector('[role=dialog]')
      const bar = document.querySelector('[role=dialog] [role=progressbar]')
      const button = document.querySelector('[role=dialog] button[type=submit]')
      window.__uploadLog.push({
        // Radix keeps the closing dialog in the DOM for its exit animation (data-state="closed"); by then
        // the list may already be refreshed and the button back to "Upload" — that is after "done".
        open: dialog?.getAttribute('data-state') === 'open',
        value: bar ? Number(bar.getAttribute('aria-valuenow')) : null,
        text: bar?.parentElement?.querySelector('p')?.textContent ?? '',
        label: button?.textContent?.trim() ?? '',
        disabled: button ? button.disabled : null,
      })
    }
    new MutationObserver(snap).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-valuenow', 'disabled'] })
  })
  // Localhost takes 50 MiB in well under a second, which leaves the bar no time to show a value between 0
  // and 100. Chromium's network emulation (CDP) caps the upload at 16 MiB/s for this one case: ~3 s.
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: 16 * 1024 * 1024 })
  const large = await uploadVia(page, trigger, { filePath: largePath, kind: 'attachment' }, NAME_A4, { timeout: 90000 })
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await cdp.detach()
  const log = (await page.evaluate(() => window.__uploadLog)).filter((e) => e.value !== null && e.open)
  const values = log.map((e) => e.value)
  const maxSeen = values.length ? Math.max(...values) : -1
  const idle = log.filter((e) => !(e.disabled === true && e.label === 'Adding…'))
  const percentShown = log.some((e) => /Uploading… \d+%/.test(e.text)) && log.some((e) => /100%/.test(e.text))
  // The browser names the MIME type of a .bin as it likes (Chromium: application/macbinary), so the row is
  // checked around it.
  const row4 = fileRow(NAME_A4)
  rec('h/3: a 50 MiB file lands: the row carries size_bytes 52428800 and the object has the bytes', large.landed && large.pendingGone && row4.startsWith(`${NAME_A4}|dcs-e2e-large-upload.bin|${FOLDER_A}/${NAME_A4}|${LARGE_BYTES}|`) && row4.endsWith(`|attachment|4|${IDS.ORIG}`) && objectRow(`${FOLDER_A}/${NAME_A4}`) === `${FOLDER_A}/${NAME_A4}|${LARGE_BYTES}`, large.alert || `${row4} / ${objectRow(`${FOLDER_A}/${NAME_A4}`)}`)
  const between = values.filter((v) => v > 0 && v < 100)
  rec('h/3: the progress bar appears at 0, shows values between, and reaches 100% (aria-valuenow), with the percent as text', values[0] === 0 && between.length > 0 && maxSeen === 100 && percentShown, `values seen: ${[...new Set(values)].join(',')}`)
  rec('h/3: while the dialog is open, at every value of the bar (0 to 100) the submit button is disabled and reads "Adding…"', log.length >= 2 && idle.length === 0, idle.length ? `not busy at: ${JSON.stringify(idle)}` : `${log.length} samples, values ${[...new Set(values)].join(',')}`)
  fs.rmSync(largePath, { force: true })

  // ---- 4. the PUT never gets an answer: the sentence replaces the bar, nothing is stored, the same file can be retried ----
  const NAME_A5 = `${SCL}_A_IDC_2026-09-19_05.pdf`
  const isSignedPut = (request) => request.method() === 'PUT' && /\/storage\/v1\/object\/upload\/sign\//.test(request.url())
  const signedUrlMatcher = (url) => url.pathname.includes('/storage/v1/object/upload/sign/')
  await page.route(signedUrlMatcher, (route) => (isSignedPut(route.request()) ? route.abort('failed') : route.continue()))
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.locator('input[type=file]').setInputFiles({ name: 'retry-me.pdf', mimeType: 'application/pdf', buffer: Buffer.from('retry') })
  await dialog.getByRole('button', { name: 'Upload' }).click()
  const alertShown = await holds(page, () => /did not reach the document store/.test(document.querySelector('[role=dialog] [role=alert]')?.textContent ?? ''), null, 10000)
  const barGone = alertShown && (await dialog.locator('[role=progressbar]').count()) === 0
  const uploadEnabled = alertShown && (await holds(page, () => { const b = document.querySelector('[role=dialog] button[type=submit]'); return !!b && !b.disabled && b.textContent.trim() === 'Upload' }, null, 5000))
  rec('h/4: a PUT with no answer (aborted in flight) gives way to the network sentence; the bar is gone and Upload is enabled again', alertShown && barGone && uploadEnabled, await dialog.locator('[role=alert]').innerText().catch(() => '(no alert)'))
  rec('h/4: nothing was stored by the failed attempt (still 4 rows, 4 objects on A)', rowsA() === 4 && objectsA() === 4 && fileRow(NAME_A5) === '', `${rowsA()} rows, ${objectsA()} objects`)
  await shot(page, 'files-h4-network-sentence')
  await page.unroute(signedUrlMatcher)
  await dialog.getByRole('button', { name: 'Upload' }).click()
  const retried = await holds(page, (n) => !!document.querySelector(`[data-file-row="${n}"]`), NAME_A5, 15000)
  rec('h/4: the same file, submitted again from the same dialog, lands as NN 05 (a fresh URL, NN recomputed)', retried && fileRow(NAME_A5).startsWith(`${NAME_A5}|retry-me.pdf|${FOLDER_A}/${NAME_A5}|5|`), fileRow(NAME_A5))
  await ctx.close()
}

// =================================================================
// (g) The expired URL
// =================================================================
if (firstSignedUrl && !process.env.E2E_SKIP_EXPIRY) {
  const wait = Math.max(0, 61000 - (Date.now() - firstSignedAt))
  console.log(`(g) waiting ${Math.ceil(wait / 1000)} s for the first signed URL to expire…`)
  await new Promise((resolve) => setTimeout(resolve, wait))
  const expired = await fetch(firstSignedUrl)
  const body = await expired.text()
  rec('g/RED: the same signed URL is refused after 60 s', expired.status !== 200 && /expired|Invalid|JWT/i.test(body), `HTTP ${expired.status} ${body.slice(0, 80)}`)
} else {
  rec('g: expiry check skipped (E2E_SKIP_EXPIRY or no URL)', !!process.env.E2E_SKIP_EXPIRY)
}

rec('no console or hydration errors on any page of any session', errors.length === 0, errors.slice(0, 3).join(' || '))
clean()
await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed.`)
process.exit(failed.length ? 1 : 0)
