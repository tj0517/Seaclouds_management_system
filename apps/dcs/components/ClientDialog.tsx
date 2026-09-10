'use client'

// DCS 1a.16: shared add/edit dialog for one clients row. `code` is a plain
// read-only Input in edit mode — belt-and-suspenders with the update action
// itself never accepting a `code` key (lib/clients-admin.ts:
// UpdateClientInput has no such field). Mirrors DictionaryEntryDialog (1a.15).
import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
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
import { createClient, updateClient } from '@/app/data/actions/clients'
import type { ClientRow } from '@/lib/clients-admin'

type Props = {
  entry?: ClientRow
  trigger: ReactNode
}

export default function ClientDialog({ entry, trigger }: Props) {
  const router = useRouter()
  const isEdit = entry !== undefined
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(entry?.name ?? '')
  const [code, setCode] = useState(entry?.code ?? '')
  const [contactEmail, setContactEmail] = useState(entry?.contact_email ?? '')
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setName(entry?.name ?? '')
    setCode(entry?.code ?? '')
    setContactEmail(entry?.contact_email ?? '')
    setNotes(entry?.notes ?? '')
    setError(null)
  }

  const handleSubmit = async () => {
    setSaving(true)
    setError(null)

    const result = isEdit
      ? await updateClient({
          id: entry.id,
          name,
          contactEmail: contactEmail.trim() === '' ? null : contactEmail,
          notes: notes.trim() === '' ? null : notes,
        })
      : await createClient({
          name,
          code,
          contactEmail: contactEmail.trim() === '' ? null : contactEmail,
          notes: notes.trim() === '' ? null : notes,
        })

    setSaving(false)
    if (!result.ok) {
      setError(result.message ?? result.error)
      return
    }
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) reset()
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit client' : 'Add client'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Code cannot be changed once a client is created.' : 'Code becomes part of CPY document numbers.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="client-name">Name</Label>
            <Input id="client-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="client-code">Code</Label>
            <Input
              id="client-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              readOnly={isEdit}
              disabled={isEdit}
              placeholder="e.g. ACME"
            />
            {isEdit ? (
              <p className="text-xs text-gray-500">
                Code is part of the document number and cannot be changed once created.
              </p>
            ) : (
              <p className="text-xs text-gray-500">2-10 characters, uppercase letters and digits only.</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="client-contact-email">Contact email</Label>
            <Input
              id="client-contact-email"
              type="email"
              value={contactEmail ?? ''}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="client-notes">Notes</Label>
            <Textarea id="client-notes" value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          {error && <p className="text-xs text-red-600">Error: {error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saving || !name.trim() || !code.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
