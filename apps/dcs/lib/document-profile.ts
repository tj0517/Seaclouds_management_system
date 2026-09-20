// DCS 1b.07: the pure decisions behind the document profile screen.
//
// Nothing here touches a database or imports Next.js, for the reason in
// vitest.config.ts (1a.12): no jsdom, no React Testing Library, so a component
// is proven by testing the function it calls. Each helper below is called by
// exactly one profile component, and each one mirrors a rule that the database
// enforces on its own — this file decides what the user SEES, RLS and the
// triggers decide what happens.
import type { Json, Tables } from '@scl/db'

// ---------------------------------------------------------------------------
// Dictionary labels
// ---------------------------------------------------------------------------

type DictionaryEmbed = { code: string | null; label: string | null }

/**
 * A dictionary value as a person reads it: "RA — Report", never a uuid.
 *
 * Every dictionary value on the profile arrives through a constraint-named
 * embed (see getDocument), so all this receives is the code and label. A
 * missing embed — a row RLS hides, or a status a future policy narrows —
 * degrades to a dash rather than throwing, the same rule the register follows
 * (docs/03-conventions.md: degrade to something visible, not to an absent row).
 */
export function dictionaryLabel(entry: DictionaryEmbed | null | undefined): string {
  if (!entry) return '—'
  const code = entry.code?.trim() ?? ''
  const label = entry.label?.trim() ?? ''
  if (code && label && code !== label) return `${code} — ${label}`
  return code || label || '—'
}

/** A profile id as a name; falls back to a short id when the directory does not list them. */
export function personName(id: string | null | undefined, nameById: ReadonlyMap<string, string | null>): string {
  if (!id) return '—'
  return nameById.get(id) ?? `${id.slice(0, 8)}…`
}

/**
 * A timestamp in UTC, to the minute: "2026-09-19 14:33 UTC".
 *
 * Fixed to UTC and labelled, because these pages render on the server (Vercel:
 * UTC, a developer's machine: local time) and an unlabelled local time would
 * make the same audit row read differently in preview and production.
 */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

// ---------------------------------------------------------------------------
// CPY number field
// ---------------------------------------------------------------------------

export type CpyFieldMode =
  | { mode: 'editable' }
  | { mode: 'numbering_off' }
  | { mode: 'read_only'; reason: 'not_dc' | 'needs_second_factor' }

/**
 * What the CPY number field shows this reader.
 *
 * MIRRORS, does not enforce. The real guards are, in order:
 *   - trigger enforce_cpy_numbering_enabled  (documents_cpy_numbering, 1b.01):
 *     the project's mdr_settings.cpy_numbering must be true;
 *   - trigger enforce_dc_only_numbering      (documents_numbering_dc_only, 1b.03):
 *     the writer must be the project's DC;
 *   - RLS "Doc controllers update documents": is_doc_controller AND aal2.
 * A wrong answer here can therefore only produce a field that is offered and
 * then refused, or one that is withheld from someone the database would have
 * let write — never a write the database would not have permitted.
 *
 * Order matters and is pinned by a test: a project without a CPY track shows
 * "numbering off" to EVERYONE, including its DC, because nobody may set the
 * value there and telling the DC "read-only, you are not the DC" would be a
 * lie about why. Only then is the reader's role considered, and last their
 * assurance level, because a DC at aal1 is the one reader who is told what to
 * fix ("verify your second factor") rather than that the field is not theirs.
 *
 * An admin who is not also the project's DC is `not_dc`: the trigger refuses
 * them too (it checks is_doc_controller only), which is what the task asked
 * for ("editable for DC only").
 */
export function cpyFieldMode(input: {
  cpyNumbering: boolean
  isProjectDc: boolean
  aal2: boolean
}): CpyFieldMode {
  if (!input.cpyNumbering) return { mode: 'numbering_off' }
  if (!input.isProjectDc) return { mode: 'read_only', reason: 'not_dc' }
  if (!input.aal2) return { mode: 'read_only', reason: 'needs_second_factor' }
  return { mode: 'editable' }
}

/** The sentence under a field that is not editable, or null when there is nothing to say. */
export function cpyFieldHint(field: CpyFieldMode): string | null {
  if (field.mode === 'editable') return null
  if (field.mode === 'numbering_off') return 'This project does not run a client (CPY) numbering track.'
  if (field.reason === 'needs_second_factor') {
    return 'Only the project’s Document Controller can set this, and it needs a session with a verified second factor.'
  }
  return 'Only the project’s Document Controller can set this number.'
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** 1536 -> "1.5 KB". Binary units, one decimal from KB up; null for a row that never recorded a size. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

/**
 * The name a file row is listed under.
 *
 * file_name, original_name and storage_path are all nullable until 1b.09
 * (docs/02-data-model.md, dcs.files), so a row can legitimately have none of
 * them. The list must still render that row.
 */
export function fileDisplayName(file: {
  file_name: string | null
  original_name: string | null
  storage_path: string | null
}): string {
  return file.file_name || file.original_name || file.storage_path?.split('/').pop() || '(unnamed file)'
}

// ---------------------------------------------------------------------------
// Panel actions and placeholder tabs
// ---------------------------------------------------------------------------

export type PanelAction = { key: string; label: string; hint: string }

/**
 * The buttons of the current-revision panel. All disabled in 1b.07: none of
 * them may write to dcs.revisions or dcs.files (acceptance 6). The hint is
 * what the tooltip and the visible caption say, and it names the task that
 * turns the button on — kept here, not in JSX, so a test can pin it.
 */
export const PANEL_ACTIONS: readonly PanelAction[] = [
  { key: 'new-revision', label: 'New Revision', hint: 'Arrives with DCS 1b.08' },
  { key: 'add-file', label: 'Add File', hint: 'Arrives with DCS 1b.09' },
  { key: 'distribute-idc', label: 'Distribute for IDC', hint: 'Phase 2/3' },
  { key: 'initiate-review', label: 'Initiate Review', hint: 'Phase 2/3' },
  { key: 'initiate-approval', label: 'Initiate Approval', hint: 'Phase 2/3' },
  { key: 'create-transmittal', label: 'Create Transmittal', hint: 'Phase 2/3' },
]

export type PlaceholderTab = { value: string; label: string; sentence: string }

/**
 * The tabs that exist only to say what will land in them.
 *
 * The task and phase in each sentence are the owner's decision (1b.07 review):
 * Comments -> DCS 2.09, References -> Phase 2 with no task number yet. Neither
 * "2.09" nor document_references appears in docs/ — the ERD in
 * docs/02-data-model.md has dcs.comments but no references table — so they are
 * recorded here as decided, not derived; do not build a data model from them.
 */
export const PLACEHOLDER_TABS: readonly PlaceholderTab[] = [
  {
    value: 'revisions',
    label: 'Revisions',
    sentence: 'Every revision of this document, with its step, status and files, arrives with DCS 1b.08 (New Revision).',
  },
  {
    value: 'plan',
    label: 'Plan',
    sentence:
      'Planned, Forecast and Actual dates for each step arrive in Phase 2 (DCS 2.12–2.14); dcs.plan_dates does not exist yet.',
  },
  {
    value: 'comments',
    label: 'Comments',
    sentence: 'Review comments and the Originator’s replies (dcs.comments) arrive with DCS 2.09 · Phase 2.',
  },
  {
    value: 'references',
    label: 'References',
    sentence: 'Links to related documents arrive in Phase 2 (document_references in the ERD, no task number yet).',
  },
  {
    value: 'transmittals',
    label: 'Transmittals',
    sentence: 'The transmittals this document was sent in arrive with the transmittal module in Phase 3 (M11).',
  },
]

// ---------------------------------------------------------------------------
// History (public.audit_log)
// ---------------------------------------------------------------------------

export type AuditRow = Pick<
  Tables<'audit_log'>,
  'id' | 'occurred_at' | 'user_id' | 'table_name' | 'record_id' | 'action' | 'field_name' | 'old_value' | 'new_value'
>

export type HistoryEntry = {
  id: string
  occurredAt: string
  actor: string
  /** 'Document' for dcs.documents, 'Revision' for dcs.revisions. */
  scope: string
  action: 'Created' | 'Changed' | 'Deleted'
  field: string | null
  from: string | null
  to: string | null
}

/** The tables the History tab reads, matching the record ids historyRecordIds returns. */
export const HISTORY_TABLES = ['dcs.documents', 'dcs.revisions'] as const

/** The document's own id plus every revision id — what public.audit_log.record_id is matched against. */
export function historyRecordIds(documentId: string, revisionIds: readonly string[]): string[] {
  return [documentId, ...revisionIds.filter((id) => id !== documentId)]
}

/** Columns whose value is a public.profiles id, shown as a name. */
const PERSON_FIELDS: ReadonlySet<string> = new Set(['originator_id', 'checker_id', 'approver_id', 'created_by'])

/**
 * One audit value as text.
 *
 * NULL means "the column was empty" (the trigger stores JSON null as SQL NULL,
 * public.audit_trigger()), so it is rendered as a dash by the caller, not as
 * the word "null". Objects only appear on INSERT/DELETE rows, which carry the
 * whole row and are not printed cell by cell.
 */
export function formatAuditValue(value: Json | null, field: string | null, nameById: ReadonlyMap<string, string | null>): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return field && PERSON_FIELDS.has(field) ? personName(value, nameById) : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

const SCOPE_BY_TABLE: Record<string, string> = {
  'dcs.documents': 'Document',
  'dcs.revisions': 'Revision',
}

/**
 * One public.audit_log row as a History line.
 *
 * INSERT and DELETE rows have field_name NULL and carry the whole row
 * (audit_trigger comment), so they become a single "Created" / "Deleted" line
 * with no old -> new — printing a 15-column JSON blob per creation would bury
 * the field changes that are the point of the tab. UPDATE rows are one per
 * changed column and become "Changed".
 */
export function describeAuditRow(row: AuditRow, nameById: ReadonlyMap<string, string | null>): HistoryEntry {
  const action = row.action === 'INSERT' ? 'Created' : row.action === 'DELETE' ? 'Deleted' : 'Changed'
  const isWholeRow = action !== 'Changed'
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actor: row.user_id ? personName(row.user_id, nameById) : 'System (no session)',
    scope: SCOPE_BY_TABLE[row.table_name] ?? row.table_name,
    action,
    field: row.field_name,
    from: isWholeRow ? null : formatAuditValue(row.old_value, row.field_name, nameById),
    to: isWholeRow ? null : formatAuditValue(row.new_value, row.field_name, nameById),
  }
}

/**
 * What the History tab says when public.audit_log returned nothing.
 *
 * Two very different situations produce an empty result and the page cannot
 * tell them apart: the document truly has no entries, or the reader is not
 * allowed to see them (RLS on audit_log allows the admin and the project's DC
 * only — "Admins read audit log", "Doc controllers read own project audit
 * log"). A denied read is an empty result, not an error, so the message names
 * both instead of claiming the document is unchanged.
 */
export const HISTORY_EMPTY_MESSAGE =
  'No history entries are visible to you. The audit log is readable only by administrators and by this project’s Document Controller, so entries may exist that your role cannot see.'
