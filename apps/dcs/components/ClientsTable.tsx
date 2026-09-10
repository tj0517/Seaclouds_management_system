'use client'

// DCS 1a.16: the clients register — table + "show inactive" toggle + add/edit
// dialogs + deactivate/reactivate. Inactive rows are filtered out by default
// and reappear, visually muted, when "show inactive" is on — a client is
// never actually deleted (projects.client_id is ON DELETE RESTRICT; there is
// no delete action in this screen at all). Mirrors DictionaryTypeTable
// (1a.15), collapsed to a single table since clients have no dict_type tabs.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import ClientDialog from '@/components/ClientDialog'
import { setClientActive } from '@/app/data/actions/clients'
import { visibleClients as computeVisibleClients, type ClientRow } from '@/lib/clients-admin'

type Props = {
  clients: ClientRow[]
  projectCounts: Record<string, number>
  canEdit: boolean
}

export default function ClientsTable({ clients, projectCounts, canEdit }: Props) {
  const router = useRouter()
  const [showInactive, setShowInactive] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const visible = computeVisibleClients(clients, showInactive)

  const handleToggleActive = async (client: ClientRow) => {
    setPendingId(client.id)
    setError(null)
    const result = await setClientActive({ id: client.id, isActive: !client.is_active })
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
        {canEdit && <ClientDialog trigger={<Button size="sm">Add client</Button>} />}
      </div>

      {error && <p className="mb-2 text-xs text-red-600">Error: {error}</p>}

      {visible.length === 0 ? (
        <p className="text-sm text-gray-500">
          {clients.length === 0 ? 'No clients yet.' : 'No active clients — toggle "Show inactive" to see the rest.'}
        </p>
      ) : (
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
              <TableRow key={client.id} className={client.is_active ? undefined : 'opacity-50'}>
                <TableCell>{client.name}</TableCell>
                <TableCell className="font-mono">{client.code}</TableCell>
                <TableCell className="text-gray-500">{client.contact_email ?? '—'}</TableCell>
                <TableCell>{projectCounts[client.id] ?? 0}</TableCell>
                <TableCell>
                  {client.is_active ? (
                    <Badge variant="secondary">Active</Badge>
                  ) : (
                    <Badge variant="outline">Inactive</Badge>
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
                        disabled={pendingId === client.id}
                        onClick={() => handleToggleActive(client)}
                      >
                        {pendingId === client.id ? '…' : client.is_active ? 'Deactivate' : 'Reactivate'}
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
