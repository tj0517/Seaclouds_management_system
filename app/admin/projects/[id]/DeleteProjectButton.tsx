'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog'
import { deleteProject } from '@/app/data/actions'

export default function DeleteProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
    const [open, setOpen] = useState(false)
    const [isPending, startTransition] = useTransition()
    const router = useRouter()

    const handleDelete = () => {
        startTransition(async () => {
            const result = await deleteProject(projectId)
            if (result.error) {
                toast.error(`Błąd: ${result.error}`)
            } else {
                toast.success(result.softDeleted
                    ? 'Projekt dezaktywowany (zawiera wpisy czasu pracy)'
                    : 'Projekt został usunięty')
                router.push('/admin/projects')
            }
            setOpen(false)
        })
    }

    return (
        <>
            <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" /> Usuń / Dezaktywuj
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Usuń projekt</DialogTitle>
                        <DialogDescription>
                            Czy na pewno chcesz usunąć projekt <strong>{projectName}</strong>?
                            Jeśli istnieją wpisy czasu pracy, projekt zostanie dezaktywowany, a nie trwale usunięty.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                            Anuluj
                        </Button>
                        <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
                            {isPending ? 'Usuwam...' : 'Usuń / Dezaktywuj'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
