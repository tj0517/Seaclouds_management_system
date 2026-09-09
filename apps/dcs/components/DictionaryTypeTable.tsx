'use client'

// DCS 1a.15: the register for one dict_type — table + "show inactive" toggle
// + add/edit dialogs + deactivate/reactivate. Inactive rows are filtered out
// by default (forms-style view) and reappear, visually muted, when "show
// inactive" is on — the row is never actually gone (dcs.dictionaries never
// deletes; is_active = false only).
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import DictionaryEntryDialog from '@/components/DictionaryEntryDialog'
import { setDictionaryEntryActive } from '@/app/data/actions/dictionaries'
import { readBudgetHours } from '@/lib/dictionaries-admin'
import { DICT_TYPE_LABELS, type DictionaryRow, type DictType } from '@/lib/dictionaries'

type Props = {
  dictType: DictType
  rows: DictionaryRow[]
  canEdit: boolean
}

export default function DictionaryTypeTable({ dictType, rows, canEdit }: Props) {
  const router = useRouter()
  const [showInactive, setShowInactive] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const visibleRows = rows.filter((row) => row.is_active || showInactive)
  const showBudgetHours = dictType === 'doc_type'

  const handleToggleActive = async (row: DictionaryRow) => {
    setPendingId(row.id)
    setError(null)
    const result = await setDictionaryEntryActive({ id: row.id, isActive: !row.is_active })
    setPendingId(null)
    if (!result.ok) {
      setError(result.message ?? result.error)
      return
    }
    router.refresh()
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} />
          Show inactive
        </label>
        {canEdit && (
          <DictionaryEntryDialog
            dictType={dictType}
            trigger={<Button size="sm">Add {DICT_TYPE_LABELS[dictType]}</Button>}
          />
        )}
      </div>

      {error && <p className="mb-2 text-xs text-red-600">Error: {error}</p>}

      {visibleRows.length === 0 ? (
        <p className="text-sm text-gray-500">
          {rows.length === 0 ? 'No entries yet.' : 'No active entries — toggle "Show inactive" to see the rest.'}
        </p>
      ) : (
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
              <TableRow key={row.id} className={row.is_active ? undefined : 'opacity-50'}>
                <TableCell className="font-mono">{row.code}</TableCell>
                <TableCell>{row.label}</TableCell>
                <TableCell className="text-gray-500">{row.description}</TableCell>
                {showBudgetHours && <TableCell>{readBudgetHours(row.meta) ?? '—'}</TableCell>}
                <TableCell>{row.sort_order}</TableCell>
                <TableCell>
                  {row.is_active ? (
                    <Badge variant="secondary">Active</Badge>
                  ) : (
                    <Badge variant="outline">Inactive</Badge>
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
                        disabled={pendingId === row.id}
                        onClick={() => handleToggleActive(row)}
                      >
                        {pendingId === row.id ? '…' : row.is_active ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
