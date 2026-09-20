// DCS 1b.07: the History tab — this document's rows from public.audit_log,
// newest first.
//
// No role gate in the UI. Whatever RLS returns is what is shown: the admin and
// the project's DC read the trail, everyone else reads an empty result — which
// is not an error, so the empty state has to say the entries may be hidden
// rather than claim there are none (HISTORY_EMPTY_MESSAGE).
import { EmptyState } from '@/components/page-chrome'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatTimestamp, HISTORY_EMPTY_MESSAGE, type HistoryEntry } from '@/lib/document-profile'

type Props = {
  entries: readonly HistoryEntry[]
  /** Set when the read hit its row cap, so the tab can say the list is cut. */
  truncatedAt: number | null
}

/** The two lines of the Change cell: what happened to what, then old -> new. */
function Change({ entry }: { entry: HistoryEntry }) {
  return (
    <div className="space-y-0.5">
      <p>
        {entry.scope} {entry.action.toLowerCase()}
        {entry.field ? (
          <>
            {' · '}
            <span className="font-mono text-xs">{entry.field}</span>
          </>
        ) : null}
      </p>
      {entry.field !== null ? (
        <p className="break-all text-xs">
          <span className="text-muted-foreground">{entry.from ?? '—'}</span>
          <span aria-hidden className="px-1.5 text-muted-foreground">
            →
          </span>
          <span className="sr-only"> to </span>
          <span className="font-medium">{entry.to ?? '—'}</span>
        </p>
      ) : null}
    </div>
  )
}

export default function DocumentHistoryTab({ entries, truncatedAt }: Props) {
  if (entries.length === 0) {
    return <EmptyState title="No history visible">{HISTORY_EMPTY_MESSAGE}</EmptyState>
  }

  // Three columns, not five: the tab shares the row with the revision panel, and
  // five columns needed a horizontal scroll at ordinary desktop widths that hid
  // the very thing the tab is for (old -> new). Action, field and the change
  // itself read as one thing, so they share a cell.
  return (
    <div className="space-y-2">
      <div className="w-full overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap align-top text-xs">{formatTimestamp(entry.occurredAt)}</TableCell>
                <TableCell className="align-top text-sm">{entry.actor}</TableCell>
                <TableCell className="align-top text-sm">
                  <Change entry={entry} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {truncatedAt !== null ? (
        <p className="text-xs text-muted-foreground">Showing the latest {truncatedAt} entries.</p>
      ) : null}
    </div>
  )
}
