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
                toast.error(`Error: ${result.error}`)
            } else {
                toast.success(result.softDeleted
                    ? 'Project deactivated (contains time entries)'
                    : 'Project deleted successfully')
                router.push('/admin/projects')
            }
            setOpen(false)
        })
    }

    return (
        <>
            <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete / Deactivate
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Project</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete <strong>{projectName}</strong>?
                            If time entries exist, the project will be deactivated instead of permanently deleted.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
                            {isPending ? 'Deleting...' : 'Delete / Deactivate'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
