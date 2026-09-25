'use client'

// DCS 1a.15: shared add/edit dialog for one dictionaries row. `code` is a
// plain read-only Input in edit mode (never rendered as an editable field at
// all in create mode's counterpart position for edit) — belt-and-suspenders
// with the update action itself never accepting a `code` key
// (lib/dictionaries-admin.ts: UpdateDictionaryEntryInput has no such field).
import { useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SKIPPED, usePendingAction } from '@/hooks/use-pending-action'
import { createDictionaryEntry, updateDictionaryEntry } from '@/app/data/actions/dictionaries'
import { readBudgetHours } from '@/lib/dictionaries-admin'
import { DICT_TYPE_LABELS, type DictionaryRow, type DictType } from '@/lib/dictionaries'

type Props = {
  dictType: DictType
  entry?: DictionaryRow
  trigger: ReactNode
}

export default function DictionaryEntryDialog({ dictType, entry, trigger }: Props) {
  // DCS 1a.24: `saving` is gone. The dialog now stays open and pending until
  // the refreshed table is on screen — closing it the instant the action
  // returned was what made a save look like it had done nothing.
  const { run, refresh, pending } = usePendingAction()
  const isEdit = entry !== undefined
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState(entry?.code ?? '')
  const [label, setLabel] = useState(entry?.label ?? '')
  const [description, setDescription] = useState(entry?.description ?? '')
  const [sortOrder, setSortOrder] = useState(String(entry?.sort_order ?? 0))
  const [budgetHours, setBudgetHours] = useState(() => {
    const current = entry ? readBudgetHours(entry.meta) : null
    return current === null ? '' : String(current)
  })
  const [error, setError] = useState<string | null>(null)

  const showBudgetHours = dictType === 'doc_type'

  const reset = () => {
    setCode(entry?.code ?? '')
    setLabel(entry?.label ?? '')
    setDescription(entry?.description ?? '')
    setSortOrder(String(entry?.sort_order ?? 0))
    const current = entry ? readBudgetHours(entry.meta) : null
    setBudgetHours(current === null ? '' : String(current))
    setError(null)
  }

  const handleSubmit = async () => {
    setError(null)

    const parsedSortOrder = sortOrder.trim() === '' ? 0 : Number(sortOrder)
    const parsedBudgetHours = showBudgetHours && budgetHours.trim() !== '' ? Number(budgetHours) : null

    const result = await run(() =>
      isEdit
        ? updateDictionaryEntry({
            id: entry.id,
            label,
            description: description.trim() === '' ? null : description,
            sortOrder: parsedSortOrder,
            budgetHours: showBudgetHours ? parsedBudgetHours : undefined,
          })
        : createDictionaryEntry({
            dictType,
            code,
            label,
            description: description.trim() === '' ? null : description,
            sortOrder: parsedSortOrder,
            budgetHours: showBudgetHours ? parsedBudgetHours : undefined,
          }),
    )

    if (result === SKIPPED) return
    if (!result.ok) {
      setError(result.message ?? result.error)
      return
    }
    setOpen(false)
    refresh()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // A save in flight must not be dismissed by an outside click or Esc.
        if (!next && pending) return
        setOpen(next)
        if (next) reset()
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit entry' : 'Add entry'}</DialogTitle>
          <DialogDescription>{DICT_TYPE_LABELS[dictType]}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="dict-code">Code</Label>
            <Input
              id="dict-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              readOnly={isEdit}
              disabled={isEdit}
              placeholder="e.g. RA"
            />
            {isEdit && (
              <p className="text-xs text-muted-foreground">
                Code is part of the document number and cannot be changed once created.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="dict-label">Label</Label>
            <Input id="dict-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="dict-description">Description</Label>
            <Textarea
              id="dict-description"
              value={description ?? ''}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="dict-sort-order">Sort order</Label>
            <p className="text-xs text-muted-foreground">Position in pick lists.</p>
            <Input
              id="dict-sort-order"
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </div>

          {showBudgetHours && (
            <div className="space-y-1">
              <Label htmlFor="dict-budget-hours">Est. budget (h)</Label>
              <p className="text-xs text-muted-foreground">
                Default hours for a new document of this type; the Originator can override it.
              </p>
              <Input
                id="dict-budget-hours"
                type="number"
                min={0}
                step="0.5"
                value={budgetHours}
                onChange={(e) => setBudgetHours(e.target.value)}
                placeholder="Optional"
              />
            </div>
          )}

          {error && <p className="text-xs text-destructive">Error: {error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={pending || !code.trim() || !label.trim()}>
            {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
