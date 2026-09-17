'use client'

// DCS 1a.15: the register for one dict_type — table + "show inactive" toggle
// + add/edit dialogs + deactivate/reactivate. Inactive rows are filtered out
// by default (forms-style view) and reappear, visually muted, when "show
// inactive" is on — the row is never actually gone (dcs.dictionaries never
// deletes; is_active = false only).
import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import DictionaryEntryDialog from '@/components/DictionaryEntryDialog'
import { SKIPPED, usePendingAction } from '@/hooks/use-pending-action'
import { setDictionaryEntryActive } from '@/app/data/actions/dictionaries'
import { readBudgetHours } from '@/lib/dictionaries-admin'
import { EmptyState, ScrollableTable } from '@/components/page-chrome'
import { DICT_TYPE_LABELS, type DictionaryRow, type DictType } from '@/lib/dictionaries'

type Props = {
  dictType: DictType
  rows: DictionaryRow[]
  canEdit: boolean
}

export default function DictionaryTypeTable({ dictType, rows, canEdit }: Props) {
  // DCS 1a.24: pendingId still names WHICH row is busy (two rows must not
  // both show a spinner), but whether anything is busy at all now comes from
  // usePendingAction — so the row stays pending through router.refresh(),
  // which is when the table actually changes.
  const { run, refresh, pending } = usePendingAction()
  const [showInactive, setShowInactive] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const visibleRows = rows.filter((row) => row.is_active || showInactive)
  const showBudgetHours = dictType === 'doc_type'

  const handleToggleActive = async (row: DictionaryRow) => {
    setError(null)
    setPendingId(row.id)
    const result = await run(() => setDictionaryEntryActive({ id: row.id, isActive: !row.is_active }))
    if (result === SKIPPED) return
    if (!result.ok) {
      setPendingId(null)
      setError(result.message ?? result.error)
      return
    }
    refresh()
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} />
          Show inactive
        </label>
        {canEdit && (
          <DictionaryEntryDialog
            dictType={dictType}
            trigger={
              <Button size="sm">
                <Plus className="mr-1.5 h-4 w-4" />
                Add {DICT_TYPE_LABELS[dictType]}
              </Button>
            }
          />
        )}
      </div>

      {error && <p className="mb-2 text-xs text-destructive">Error: {error}</p>}

      {visibleRows.length === 0 ? (
        <EmptyState title={rows.length === 0 ? 'No entries yet' : 'No active entries'}>
          {rows.length === 0 ? null : 'Toggle “Show inactive” to see the rest — nothing here is ever deleted.'}
        </EmptyState>
      ) : (
        <ScrollableTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Description</TableHead>
              {showBudgetHours && <TableHead>Budget hours</TableHead>}
              <TableHead>Sort order</TableHead>
              <TableHead>Status</TableHead>
              {canEdit && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) => (
              <TableRow key={row.id} className={row.is_active ? undefined : 'opacity-60'}>
                <TableCell className="font-mono text-xs">{row.code}</TableCell>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell className="text-muted-foreground">{row.description}</TableCell>
                {showBudgetHours && <TableCell>{readBudgetHours(row.meta) ?? '—'}</TableCell>}
                <TableCell>{row.sort_order}</TableCell>
                <TableCell>
                  {row.is_active ? (
                    <Badge className="border-transparent bg-success-bg text-success hover:bg-success-bg">Active</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Inactive
                    </Badge>
                  )}
                </TableCell>
                {canEdit && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <DictionaryEntryDialog
                        dictType={dictType}
                        entry={row}
                        trigger={
                          <Button size="sm" variant="outline">
                            Edit
                          </Button>
                        }
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => handleToggleActive(row)}
                      >
                        {pending && pendingId === row.id && (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        )}
                        {row.is_active ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </ScrollableTable>
      )}
    </div>
  )
}
