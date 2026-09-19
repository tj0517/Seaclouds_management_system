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
// TES's pdf.ts uploads to a bucket with the service_role client and returns a
// signed URL, and that is right for a monthly report that has to be re-fetched
// and shown to an admin later. This is the opposite case — a throwaway view of
// data the caller can already read, wanted once, now. Returning the bytes
// means: no bucket, no service_role anywhere near it, nothing persisted that
// would need a retention rule, and no second copy of a project's register
// sitting in storage under a path someone could guess. The size ceiling that
// makes this safe is MDR_EXPORT_MAX_ROWS in lib/mdr.ts.
//
// NO GUARD, deliberately, and for the same reason /mdr has no page guard:
// dcs.v_mdr is security_invoker, so this action can only ever export rows the
// caller could already see on the screen. An outsider gets an empty sheet —
// not a redirect, and not someone else's register.
// Marks this module server-only: importing it from a client component is a
// build error rather than a runtime surprise. The CI guard ("service_role only
// in server-only modules") requires it of any file mentioning that key, and
// the mention above is a comment — but the import is correct on its own terms
// and is what the guard is asking for. An earlier revision of this file dodged
// the guard by rewording the comment; that left the guard satisfied while the
// module was no more protected than before.
//
// It belongs HERE and not in lib/mdr-export.ts. `server-only` resolves to an
// empty module under the `react-server` condition and to one that THROWS under
// `default` — so a lib/ module carrying it would break the moment Vitest
// imported it, which lib/mdr-export.test.ts and lib/mdr-export.fidelity.ts
// both do. That split is the intended shape: this file is the server boundary,
// lib/mdr-export.ts is framework-agnostic and testable.
import 'server-only'
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
