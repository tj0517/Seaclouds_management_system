// DCS 1b.06: the export-fidelity proof — acceptance criterion 1.
//
// Seeds ~50 documents on the LOCAL stack, signs in as a real user, calls
// exportMdr() — the function the "Export to Excel" server action calls — reads
// the .xlsx back with exceljs, and diffs its rows (count AND order) against
// `select … from dcs.v_mdr where <the same filters>` run independently in SQL.
// Three filter sets, plus a control. Then tears the fixtures down.
//
// ---------------------------------------------------------------------------
// NOT PART OF `pnpm test:unit`, ON PURPOSE
// ---------------------------------------------------------------------------
// The filename is `.fidelity.ts`, and vitest.config.ts collects `**/*.test.ts`
// — so CI never runs this. It needs a running `supabase start` and a `psql` on
// PATH, neither of which CI has, and it WRITES TO A DATABASE, which no unit
// test in this repo does. Run it by hand, from apps/dcs:
//
//   NODE_OPTIONS=--experimental-websocket \
//     pnpm exec vitest run --config vitest.fidelity.config.ts
//
// NODE_OPTIONS is not optional on the pinned toolchain. supabase-js v2.112
// constructs a RealtimeClient inside createClient() and asks for a global
// WebSocket; Node 20 (docs/toolchain.md) has one only behind that flag, and
// without it createClient throws "native WebSocket not found" before a single
// query runs. Nothing here uses realtime — it is initialised regardless. The
// flag becomes unnecessary on Node 22.
//
// ---------------------------------------------------------------------------
// RUN `supabase db reset` AFTERWARDS. MEASURED, NOT PRECAUTIONARY.
// ---------------------------------------------------------------------------
// The teardown below removes every row this file created — documents,
// revisions, mdr_settings, project_roles, projects, users — and asserts that
// it did. What it does NOT remove is the trail those writes leave in
// public.audit_log: ten tables carry audit_trigger() (dcs.documents,
// dcs.revisions, dcs.mdr_settings, dcs.project_roles and public.projects among
// them), audit_log has no FK to projects, so deleting a project leaves its
// audit rows behind.
//
// That is not cosmetic. Measured 2026-09-19: after a few runs, 472 audit rows
// for the two fixture projects remained, and they FAIL two pgTAP files —
// audit_log.test.sql test 31 and audit_mdr_settings.test.sql tests 9, 18 and
// 19 — each of which reads audit_log expecting only the seed's own rows. The
// suite went from 863 assertions passing to four failures that have nothing to
// do with the code under test.
//
// The teardown deliberately does not delete from public.audit_log. Clearing it
// is a `supabase db reset`, which is one command, rebuilds from migrations and
// seed, and needs no special-casing of the one table the project treats as
// evidence rather than as data.
//
// ---------------------------------------------------------------------------
// WHAT MAKES THIS A PROOF AND NOT A TAUTOLOGY
// ---------------------------------------------------------------------------
// The expected side is written in SQL, by hand, against dcs.v_mdr. It does not
// call listMdrAll, applyMdrQuery, or anything else the export uses. If the
// export's filter translation is wrong, the two sides disagree.
//
// ---------------------------------------------------------------------------
// WHY NOT A pgTAP TRANSACTION, since the acceptance criterion asked for one
// ---------------------------------------------------------------------------
// PostgREST serves the export over HTTP and cannot see another session's
// uncommitted rows, so "seeded inside a test transaction" and "the real
// export" cannot both hold. Agreed with the owner 2026-09-19 to keep the real
// export and take isolation from the local database being disposable plus the
// teardown in afterAll. assertLocal() is what keeps it there: this file
// refuses to run against anything but 127.0.0.1.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import { exportMdr } from './mdr-export'

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const API = 'http://127.0.0.1:54321'
const PUBLISHABLE =
  process.env.LOCAL_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'

const SEED_SQL = join(__dirname, '..', '..', '..', 'scripts', 'mdr-export-fidelity.sql')
const MEMBER = { email: 'fidelity-member@example.com', password: 'fidelity-pass' }
const PROJECT = 'eeeeeeee-0000-4000-8000-000000000001'
const OTHER_PROJECT = 'eeeeeeee-0000-4000-8000-000000000002'

/**
 * This file writes rows and deletes them, so it must be incapable of pointing
 * anywhere but the local stack. Checked before anything runs, not left to
 * convention.
 */
function assertLocal() {
  for (const url of [DB, API]) {
    if (!url.includes('127.0.0.1')) throw new Error(`refusing a non-local target: ${url}`)
  }
}

function psql(sql: string): string {
  return execFileSync('psql', [DB, '-At', '-c', sql], { encoding: 'utf8' })
}

/** Reads a built workbook back, the way Excel would. */
async function readBack(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook()
  type Loadable = Parameters<typeof workbook.xlsx.load>[0]
  await workbook.xlsx.load(buffer as unknown as Loadable)
  const sheet = workbook.getWorksheet('MDR')
  // Thrown rather than asserted non-null: if the sheet is missing, THIS is the
  // failure worth reporting, not a cell read blowing up three lines later.
  if (!sheet) throw new Error('the workbook has no MDR worksheet')
  return sheet
}

/** The SCL numbers in a built workbook, top to bottom — the sheet's own order. */
async function sheetNumbers(buffer: Buffer): Promise<string[]> {
  const sheet = await readBack(buffer)

  // Located by heading, not by a hard-coded index, so a column added to
  // DOCUMENT INFO later does not make this read the wrong column and still
  // pass for the wrong reason.
  const column = (sheet.getRow(2).values as unknown[]).indexOf('SCL Doc. Number')
  const numbers: string[] = []
  for (let r = 3; r <= sheet.rowCount; r += 1) {
    const value = sheet.getRow(r).getCell(column).value
    // The footnote two rows below the data is not a document.
    if (typeof value === 'string' && value.startsWith('SC')) numbers.push(value)
  }
  return numbers
}

let supabase: SupabaseClient
let outDir: string
let disciplineId: string
let statusId: string

describe('MDR export fidelity (local stack)', () => {
  beforeAll(async () => {
    assertLocal()
    execFileSync('psql', [DB, '-q', '-v', 'ON_ERROR_STOP=1', '-f', SEED_SQL], { stdio: 'inherit' })

    // Dictionary ids are per-database, so the filter cases are completed here
    // rather than hard-coded.
    disciplineId = psql(
      `select id from dcs.dictionaries where dict_type = 'discipline' and code = 'B00'`,
    ).trim()
    statusId = psql(
      `select id from dcs.dictionaries where dict_type = 'workflow_status' and code = 'IDC'`,
    ).trim()

    supabase = createClient(API, PUBLISHABLE)
    const { error } = await supabase.auth.signInWithPassword(MEMBER)
    if (error) throw new Error(`sign-in failed: ${error.message}`)

    outDir = mkdtempSync(join(tmpdir(), 'mdr-export-'))
  }, 120_000)

  afterAll(() => {
    // Always, pass or fail: this database is shared with `supabase test db`,
    // and 55 documents left behind would change what the next run measures.
    psql(`
      delete from dcs.documents where project_id in ('${PROJECT}', '${OTHER_PROJECT}');
      delete from dcs.mdr_settings where project_id in ('${PROJECT}', '${OTHER_PROJECT}');
      delete from public.projects where id in ('${PROJECT}', '${OTHER_PROJECT}');
      delete from auth.users where email in ('${MEMBER.email}', 'fidelity-outsider@example.com');
    `)
    const left = psql(`select count(*) from dcs.documents where scl_doc_number like 'SC990%'`).trim()
    // Reported as an assertion rather than a console line: a teardown that
    // silently half-worked is how the NEXT run gets a confusing failure.
    expect(left, 'fixtures left behind — run `supabase db reset`').toBe('0')

    // The part the teardown cannot undo — said out loud, because the next
    // `supabase test db` will otherwise fail in two files that look unrelated
    // to anything here. See the header.
    const trail = psql(`
      select count(*) from public.audit_log
       where project_id in ('${PROJECT}', '${OTHER_PROJECT}')
    `).trim()
    if (trail !== '0') {
      console.warn(
        `\n  NOTE: ${trail} rows remain in public.audit_log from these fixtures.\n` +
          '  They are not deleted here (audit_log is evidence, not test data).\n' +
          '  Run `supabase db reset` before the next `supabase test db`, or\n' +
          '  audit_log.test.sql and audit_mdr_settings.test.sql will fail.\n',
      )
    }
  })

  it('seeded ~50 documents the member can read, plus 5 they cannot', () => {
    expect(psql(`select count(*) from dcs.documents where project_id = '${PROJECT}'`).trim()).toBe('50')
    expect(psql(`select count(*) from dcs.documents where project_id = '${OTHER_PROJECT}'`).trim()).toBe('5')
  })

  /**
   * One filter set: export it, ask SQL the same question independently, and
   * require the two to agree on BOTH count and order.
   */
  async function check(params: Record<string, string>, where: string, order: string) {
    const { filename, buffer, rowCount } = await exportMdr(supabase, params)
    writeFileSync(join(outDir, filename), buffer)

    const got = await sheetNumbers(buffer)
    const raw = psql(
      `select scl_doc_number from dcs.v_mdr where ${where} order by ${order}`,
    ).trim()
    const want = raw === '' ? [] : raw.split('\n')

    // Both assertions matter and they are separate on purpose: equal counts
    // with a shuffled order is exactly the bug an unstable sort produces, and
    // a single deep-equal would report it as an unreadable diff.
    expect(got.length, `row COUNT for ${filename}`).toBe(want.length)
    expect(got, `row ORDER for ${filename}`).toEqual(want)
    expect(rowCount, 'the action agrees with its own sheet').toBe(want.length)
    return { filename, count: got.length }
  }

  it('case 1 — project filter only, the register default sort', async () => {
    const { count } = await check(
      { project: PROJECT },
      `project_id = '${PROJECT}'`,
      'scl_doc_number asc nulls last',
    )
    // A fixture that selected nothing would pass every assertion above.
    expect(count).toBe(50)
  }, 60_000)

  it('case 2 — project + discipline + status, sorted by title descending', async () => {
    const { count } = await check(
      { project: PROJECT, discipline: disciplineId, status: statusId, sort: 'title', dir: 'desc' },
      `project_id = '${PROJECT}' and discipline_id = '${disciplineId}' and workflow_status_id = '${statusId}'`,
      'title desc nulls last, scl_doc_number asc nulls last',
    )
    // A real, non-trivial subset: neither everything nor nothing.
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(50)
  }, 60_000)

  it('case 3 — a search term over search_text, sorted by issue date descending', async () => {
    const { count } = await check(
      { project: PROJECT, q: 'Platform layout', sort: 'issue_date', dir: 'desc' },
      `project_id = '${PROJECT}' and search_text ilike '%Platform layout%'`,
      'issue_date desc nulls last, scl_doc_number asc nulls last',
    )
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(50)
  }, 60_000)

  it('exports only the visible columns when the view narrows them', async () => {
    const { buffer } = await exportMdr(supabase, {
      project: PROJECT,
      cols: 'scl_doc_number,title,workflow_status_code',
    })
    const sheet = await readBack(buffer)
    expect((sheet.getRow(2).values as unknown[]).filter(Boolean)).toEqual([
      'SCL Doc. Number',
      'Title',
      'Status',
    ])
    // And the rows are still the register's rows, not a narrowed query.
    expect((await sheetNumbers(buffer)).length).toBe(50)
  }, 60_000)

  // THE CONTROL. Without it, every case above is equally consistent with the
  // export ignoring RLS and the project filter merely hiding the evidence.
  it('an UNFILTERED export contains none of the project the member has no role on', async () => {
    const { buffer } = await exportMdr(supabase, {})
    const numbers = await sheetNumbers(buffer)
    expect(numbers.filter((n) => n.startsWith('SC9907'))).toEqual([])
    // And it does contain the member's own — otherwise "none of the other
    // project" would be satisfied by an empty sheet.
    expect(numbers.filter((n) => n.startsWith('SC9906')).length).toBe(50)
  }, 60_000)

  it('names the file MDR_[project_code]_[YYYY-MM-DD].xlsx', async () => {
    const { filename } = await exportMdr(supabase, { project: PROJECT })
    expect(filename).toMatch(/^MDR_SC9906_\d{4}-\d{2}-\d{2}\.xlsx$/)
    const { filename: unfiltered } = await exportMdr(supabase, {})
    expect(unfiltered).toMatch(/^MDR_ALL_\d{4}-\d{2}-\d{2}\.xlsx$/)
  }, 60_000)
})
