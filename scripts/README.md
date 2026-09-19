# `scripts/`

Verification and guard scripts. Nothing here is imported by an application, and
nothing here runs in a build.

`scripts/` is a pnpm workspace member on purpose (`@scl/scripts`, no
dependencies, no `build` script) so that a PR touching only this directory is
attributed to a package rather than counting as a global change — see
`docs/03-conventions.md`, "Workspace (pnpm) i zakres buildów Vercela".

| File | What it is |
|---|---|
| `check-dict-types.sh` | CI guard: the `DICT_TYPES` list in TypeScript must match the `dict_type` CHECK in the database. |
| `mdr-export-fidelity.sql` | Fixtures for the MDR export fidelity proof (DCS 1b.06). Run by `apps/dcs/lib/mdr-export.fidelity.ts`, never on its own, and never against anything but the local stack. |
| `validate-xlsx.py` | Validates a generated `.xlsx` as an OPC package. See below. |

---

## `validate-xlsx.py`

```bash
python3 scripts/validate-xlsx.py FILE.xlsx [FILE.xlsx ...]
```

Exit code `0` when every file is valid, `1` otherwise. Python standard library
only — no `openpyxl`, no install step, and deliberately **not** exceljs.

**Why it is not exceljs.** `apps/dcs` writes the MDR export with exceljs and its
tests read the result back with exceljs. That round trip proves the two halves
of one library agree with each other; it cannot prove the file is well formed,
because a library will happily read back its own malformed output. This script
shares no code with the export, and should not be refactored to — sharing the
column list or the sheet name would make it agree with the export by
construction, which is the one thing it must not do.

### What it checks

Exactly the conditions that make Excel show *"We found a problem with some
content in <file>. Do you want us to try to recover as much as we can?"* — the
prompt that appears before the user sees a single cell.

1. The container is a valid ZIP and every entry passes its CRC.
2. The required OPC parts exist: `[Content_Types].xml`, `_rels/.rels`,
   `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`.
3. Every `.xml` and `.rels` part parses as XML.
4. Every relationship `Target` resolves to a part actually in the package — a
   dangling relationship is the classic silent corruption.
5. Every worksheet part has an `Override` in `[Content_Types].xml`.
6. The workbook declares a sheet named `MDR`.
7. The cells resolve: shared strings are dereferenced and the grid is rebuilt
   from each cell's own `r=` reference, so the **data** is parsed rather than
   merely present. (Empty cells are omitted from the XML entirely, so reading
   by position rather than by reference silently misreads a sparse row.)

### What it does NOT check

Read this before quoting a pass.

- **Formatting of any kind** — fills, fonts, colours, number formats, column
  widths, freeze panes. A sheet whose status colours are all wrong, or whose
  dates render as `46284`, passes here.
- **Formulas.** It reads cached values and does not evaluate. This export
  contains no formulas, so a pass says nothing either way.
- **How the sheet looks** — layout, readability, whether a human would call it
  correct.
- **Whether the rows are the right rows.** That is fidelity, and it is proved
  against `dcs.v_mdr` in `apps/dcs/lib/mdr-export.fidelity.ts`.

So a pass means *"Excel will open this without offering to repair it"*. It does
not mean the file is correct.

### Getting files to point it at

The fidelity suite writes its exports to `MDR_EXPORT_OUT_DIR` when set:

```bash
cd apps/dcs
MDR_EXPORT_OUT_DIR=/tmp/mdr NODE_OPTIONS=--experimental-websocket \
  pnpm exec vitest run --config vitest.fidelity.config.ts
cd ../..
python3 scripts/validate-xlsx.py /tmp/mdr/*.xlsx
```

Not wired into CI, deliberately: producing the files needs a running
`supabase start` and a `psql`, which CI does not have.
