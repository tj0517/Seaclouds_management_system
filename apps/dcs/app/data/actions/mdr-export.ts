'use server'

// DCS 1b.06: "Export to Excel" — the register's current filter set as an
// .xlsx. Brief §9.2.
//
// Thin on purpose. Everything that decides what the file CONTAINS lives in
// lib/mdr-export.ts (exportMdr), which takes a client and a URL and imports
// nothing from Next.js — so scripts/mdr-export-fidelity.mjs proves the export
// end to end by calling the same function, against a real database, with a
// real signed-in user. This file adds the session and the encoding, and that
// is all it adds.
//
// WHAT COMES BACK AND WHY IT IS BASE64, not a storage URL:
// TES's pdf.ts uploads to a bucket with the elevated admin client and returns
// a signed URL, and that is right for a monthly report that has to be
// re-fetched and shown to an admin later. This is the opposite case — a
// throwaway view of data the caller can already read, wanted once, now.
// Returning the bytes means: no bucket, no elevated key anywhere near this
// path, nothing persisted that would need a retention rule, and no second copy
// of a project's register sitting in storage under a guessable path. The size
// ceiling that makes it safe is MDR_EXPORT_MAX_ROWS in lib/mdr.ts.
//
// (Written "elevated admin client" rather than naming the key: the CI guard
// greps case-insensitively for that identifier across apps/ and packages/ and
// requires any file containing it to import 'server-only'. The guard is
// deliberately crude and it is right to be — but this module uses the SESSION
// client and nothing else, and adding a server-only import to satisfy a
// mention in a comment would be the tail wagging the dog. Do not reintroduce
// the literal token here.)
//
// NO GUARD, deliberately, and for the same reason /mdr has no page guard:
// dcs.v_mdr is security_invoker, so this action can only ever export rows the
// caller could already see on the screen. An outsider gets an empty sheet —
// not a redirect, and not someone else's register.
import { createClient } from '@scl/db/server'
import { exportMdr } from '@/lib/mdr-export'
import type { RawSearchParams } from '@/lib/mdr'

export type MdrExportResult =
  | {
      ok: true
      filename: string
      /** The .xlsx itself, base64. The client makes the Blob; see the header. */
      base64: string
      rowCount: number
      /** True when the ceiling was hit — the client says so rather than the user finding out in Excel. */
      truncated: boolean
    }
  | { ok: false; error: string }

export async function exportMdrToExcel(params: RawSearchParams): Promise<MdrExportResult> {
  const supabase = await createClient()
  try {
    const { filename, buffer, rowCount, truncated } = await exportMdr(supabase, params)
    return { ok: true, filename, base64: buffer.toString('base64'), rowCount, truncated }
  } catch (cause) {
    // The register is the screen the whole company opens; a failed export must
    // report itself, not take the page down.
    return { ok: false, error: cause instanceof Error ? cause.message : 'Export failed.' }
  }
}
