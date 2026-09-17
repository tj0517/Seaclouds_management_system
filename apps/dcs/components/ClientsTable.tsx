'use client'

// DCS 1a.16: the clients register — table + "show inactive" toggle + add/edit
// dialogs + deactivate/reactivate. Inactive rows are filtered out by default
// and reappear, visually muted, when "show inactive" is on — a client is
// never actually deleted (projects.client_id is ON DELETE RESTRICT; there is
// no delete action in this screen at all). Mirrors DictionaryTypeTable
// (1a.15), collapsed to a single table since clients have no dict_type tabs.
import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import ClientDialog from '@/components/ClientDialog'
import { EmptyState, ScrollableTable } from '@/components/page-chrome'
import { SKIPPED, usePendingAction } from '@/hooks/use-pending-action'
import { setClientActive } from '@/app/data/actions/clients'
import { visibleClients as computeVisibleClients, type ClientRow } from '@/lib/clients-admin'

type Props = {
  clients: ClientRow[]
  projectCounts: Record<string, number>
  canEdit: boolean
}

export default function ClientsTable({ clients, projectCounts, canEdit }: Props) {
  // DCS 1a.24: see DictionaryTypeTable — pendingId names the busy row, the
  // hook decides whether anything is busy and holds it through the refresh.
  const { run, refresh, pending } = usePendingAction()
  const [showInactive, setShowInactive] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const visible = computeVisibleClients(clients, showInactive)

  const handleToggleActive = async (client: ClientRow) => {
    setError(null)
    setPendingId(client.id)
    const result = await run(() => setClientActive({ id: client.id, isActive: !client.is_active }))
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
          <ClientDialog
            trigger={
              <Button size="sm">
                <Plus className="mr-1.5 h-4 w-4" />
                Add client
              </Button>
            }
          />
        )}
      </div>

      {error && <p className="mb-2 text-xs text-destructive">Error: {error}</p>}

      {visible.length === 0 ? (
        <EmptyState title={clients.length === 0 ? 'No clients yet' : 'No active clients'}>
          {clients.length === 0
            ? 'Clients drive CPY document numbering — add the first one to get started.'
            : 'Toggle “Show inactive” to see the rest — a client is never deleted.'}
        </EmptyState>
      ) : (
        <ScrollableTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Contact email</TableHead>
              <TableHead>Projects</TableHead>
              <TableHead>Status</TableHead>
              {canEdit && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((client) => (
              <TableRow key={client.id} className={client.is_active ? undefined : 'opacity-60'}>
                <TableCell className="font-medium">{client.name}</TableCell>
                <TableCell className="font-mono text-xs">{client.code}</TableCell>
                <TableCell className="text-muted-foreground">{client.contact_email ?? '—'}</TableCell>
                <TableCell className="tabular-nums">{projectCounts[client.id] ?? 0}</TableCell>
                <TableCell>
                  {client.is_active ? (
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
                      <ClientDialog
                        entry={client}
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
                        onClick={() => handleToggleActive(client)}
                      >
                        {pending && pendingId === client.id && (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        )}
                        {client.is_active ? 'Deactivate' : 'Reactivate'}
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
