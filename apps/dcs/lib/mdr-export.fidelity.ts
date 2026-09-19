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
// THE TEARDOWN IS COMPLETE, INCLUDING public.audit_log — MEASURED
// ---------------------------------------------------------------------------
// This suite can be run repeatedly with no `supabase db reset` between runs.
// Verified 2026-09-19: three consecutive runs from one reset, audit_log at 116
// rows before and after every one of them (drift 0), then `supabase test db`
// Files=27 Tests=866 PASS with no reset at any point.
//
// That is not free, and the reason is worth knowing before touching afterAll.
// Ten tables carry audit_trigger() and public.audit_log has no FK to projects,
// so every write AND every delete this file makes leaves a trail. Left alone
// it fails four assertions in audit_log.test.sql and audit_mdr_settings.test.sql
// — which is how this was found, as two files failing for reasons that look
// unrelated to anything here.
//
// Two kinds of row have to be cleaned, and only the first is obvious:
//   * rows carrying one of the three fixture project ids;
//   * rows with project_id NULL that this fixture nonetheless owns —
//     public.profiles and public.module_permissions, the latter created by the
//     grant_default_module_access() trigger with a fresh uuid per run. Eight
//     per run, invisible to a project-scoped delete, and the reason afterAll
//     captures ids into a temp table before deleting anything.
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
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import { exportMdr } from './mdr-export'

// The ONLY things that decide what this file touches. Compared by strict
// equality below, never by `includes` — see assertLocal().
const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const LOCAL_API = 'http://127.0.0.1:54321'
const DB = LOCAL_DB
const API = LOCAL_API
const PUBLISHABLE =
  process.env.LOCAL_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'

const SEED_SQL = join(__dirname, '..', '..', '..', 'scripts', 'mdr-export-fidelity.sql')
const MEMBER = { email: 'fidelity-member@example.com', password: 'fidelity-pass' }
const MEMBER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const OUTSIDER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'
const PROJECT = 'eeeeeeee-0000-4000-8000-000000000001'        // SC9906, member reads
const OTHER_PROJECT = 'eeeeeeee-0000-4000-8000-000000000002'  // SC9907, member does NOT
const SECOND_PROJECT = 'eeeeeeee-0000-4000-8000-000000000003' // SC9908, member reads

/** Every project this file creates — the exact scope of everything it deletes. */
const FIXTURE_PROJECTS = [PROJECT, OTHER_PROJECT, SECOND_PROJECT]
const FIXTURE_LIST = FIXTURE_PROJECTS.map((id) => `'${id}'`).join(', ')

/**
 * THE GUARD. This file writes rows and deletes them — including from
 * public.audit_log — so it must be incapable of pointing anywhere but the
 * local stack.
 *
 * STRICT EQUALITY on the connection string, not `includes`, and this is the
 * whole control rather than the first of several: the DSN is literally the
 * argument psql connects with, there is no environment override for it, and
 * nothing else in this file selects a target. A substring check would accept
 * `postgresql://…@db.tfbzivfsqsgebegcvfah.supabase.co/…?options=127.0.0.1`.
 *
 * Runtime checks against the SERVER were tried and rejected as theatre, which
 * is worth recording so nobody adds them back believing they help:
 *   * inet_server_addr() returns the CONTAINER's address (192.168.107.8,
 *     port 5432 — measured), not the published 127.0.0.1:54322, so comparing
 *     it to a loopback literal fails on the local stack and proves nothing.
 *   * The pgbouncer schema, and the supabase_* role set, are present on BOTH
 *     the local stack and scl-dev (read 2026-09-19). Neither discriminates.
 *
 * What does discriminate, beyond the literal: this DSN is superuser/plaintext
 * on a loopback port. Neither remote would accept it — they are not on
 * 127.0.0.1:54322 and their passwords are not `postgres`. If a connection on
 * this string succeeds at all, it is the local stack.
 */
function assertLocal() {
  if (DB !== LOCAL_DB) throw new Error(`refusing a non-local database: ${DB}`)
  if (API !== LOCAL_API) throw new Error(`refusing a non-local API: ${API}`)
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

    // A caller-supplied directory when given, so the generated .xlsx files can
    // be handed to a reader that is NOT exceljs (see the OPC validation in the
    // 1b.06 verification notes) rather than vanishing into a temp dir.
    outDir = process.env.MDR_EXPORT_OUT_DIR ?? mkdtempSync(join(tmpdir(), 'mdr-export-'))
    mkdirSync(outDir, { recursive: true })
    console.log(`  exports written to ${outDir}`)
  }, 120_000)

  afterAll(() => {
    // Always, pass or fail: this database is shared with `supabase test db`,
    // and fixtures left behind would change what the next run measures.
    //
    // ONE psql session, because the audit cleanup below needs ids that stop
    // existing halfway through it (see _fx) and a temp table does not survive
    // between separate psql invocations.
    assertLocal()

    const out = psql(`
      -- Rows this fixture OWNS but which carry no project_id, so a
      -- project-scoped delete cannot reach them. Captured BEFORE the deletes,
      -- because deleting the users is what destroys the ids.
      --   * public.profiles     — record_id is the fixture user's own uuid
      --   * public.module_permissions — created by the
      --     grant_default_module_access() trigger on profiles INSERT (1a.22);
      --     its record_id is a fresh uuid per run, so it can only be captured,
      --     never written down as a literal.
      create temp table _fx(id uuid);
      insert into _fx select id from public.module_permissions
        where user_id in ('${MEMBER_ID}', '${OUTSIDER_ID}');
      insert into _fx select id from public.profiles
        where id in ('${MEMBER_ID}', '${OUTSIDER_ID}');

      delete from dcs.documents where project_id in (${FIXTURE_LIST});
      delete from dcs.mdr_settings where project_id in (${FIXTURE_LIST});
      delete from dcs.project_roles where project_id in (${FIXTURE_LIST});
      delete from public.projects where id in (${FIXTURE_LIST});
      delete from auth.users where id in ('${MEMBER_ID}', '${OUTSIDER_ID}');

      create temp table _counts as select
        (select count(*) from public.audit_log) as total_before,
        (select count(*) from public.audit_log
          where project_id in (${FIXTURE_LIST})
             or record_id in (select id from _fx)) as in_scope;

      delete from public.audit_log
       where project_id in (${FIXTURE_LIST})
          or record_id in (select id from _fx);

      select total_before, in_scope,
             (select count(*) from public.audit_log) as total_after,
             (select count(*) from public.audit_log
               where project_id in (${FIXTURE_LIST})
                  or record_id in (select id from _fx)) as left_in_scope
        from _counts;
    `)

    const [totalBefore, inScope, totalAfter, leftInScope] = out
      .trim()
      .split('\n')
      .slice(-1)[0]
      .split('|')
      .map(Number)

    // ---------------------------------------------------------------------
    // Why public.audit_log is cleaned here at all, and how it is fenced
    // ---------------------------------------------------------------------
    // Ten tables carry audit_trigger(); audit_log has no FK to projects, so
    // every write and every delete above leaves a trail. Measured: left alone
    // it FAILS four assertions in audit_log.test.sql and
    // audit_mdr_settings.test.sql, which read the table expecting only the
    // seed's own rows — the next `supabase test db` then breaks in two files
    // that look unrelated to anything here.
    //
    // public.audit_log is the one table this project treats as evidence rather
    // than as data (CLAUDE.md: NEVER on production). So the delete is fenced
    // three ways, each load-bearing:
    //   1. assertLocal() immediately above — strict equality on the local DSN,
    //      re-checked here and not only in beforeAll, so the guard cannot be
    //      skipped by reaching this hook another way.
    //   2. An enumerated scope: the three fixture project ids, plus the record
    //      ids this fixture itself created. Nothing else is in range.
    //   3. The reconciliation below. If the statement removed one row more
    //      than it counted, that is a discrepancy in an evidence table and the
    //      test says so loudly rather than leaving it to be found later.
    expect(leftInScope, 'fixture audit rows remain after teardown').toBe(0)
    expect(
      totalBefore - totalAfter,
      'the delete removed rows OUTSIDE the enumerated fixture scope',
    ).toBe(inScope)

    const left = psql(`select count(*) from dcs.documents where scl_doc_number like 'SC990%'`).trim()
    // Reported as an assertion rather than a console line: a teardown that
    // silently half-worked is how the NEXT run gets a confusing failure.
    expect(left, 'fixtures left behind — run `supabase db reset`').toBe('0')
  })

  it('seeded 50 + 2 documents the member can read, plus 5 they cannot', () => {
    expect(psql(`select count(*) from dcs.documents where project_id = '${PROJECT}'`).trim()).toBe('50')
    expect(psql(`select count(*) from dcs.documents where project_id = '${SECOND_PROJECT}'`).trim()).toBe('2')
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
    // And it does contain BOTH projects the member may read — otherwise "none
    // of the other project" would be satisfied by an empty sheet.
    expect(numbers.filter((n) => n.startsWith('SC9906')).length).toBe(50)
    expect(numbers.filter((n) => n.startsWith('SC9908')).length).toBe(2)
  }, 60_000)

  // Acceptance criterion 2, for TWO different projects — one project would be
  // satisfied by a hard-coded string, and the code has to come from the rows
  // the filter actually matched.
  it('names the file MDR_[project_code]_[YYYY-MM-DD].xlsx, per project', async () => {
    const today = new Date()
    const day = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-')

    const first = await exportMdr(supabase, { project: PROJECT })
    const second = await exportMdr(supabase, { project: SECOND_PROJECT })
    const unfiltered = await exportMdr(supabase, {})

    writeFileSync(join(outDir, first.filename), first.buffer)
    writeFileSync(join(outDir, second.filename), second.buffer)
    writeFileSync(join(outDir, unfiltered.filename), unfiltered.buffer)

    expect(first.filename).toBe(`MDR_SC9906_${day}.xlsx`)
    expect(second.filename).toBe(`MDR_SC9908_${day}.xlsx`)
    // Two different projects really do produce two different names.
    expect(first.filename).not.toBe(second.filename)
    // And no project filter means no single code to name it after.
    expect(unfiltered.filename).toBe(`MDR_ALL_${day}.xlsx`)

    // The generic shape the criterion states, asserted as such.
    for (const name of [first.filename, second.filename, unfiltered.filename]) {
      expect(name).toMatch(/^MDR_[A-Za-z0-9._-]+_\d{4}-\d{2}-\d{2}\.xlsx$/)
    }
  }, 60_000)
})
