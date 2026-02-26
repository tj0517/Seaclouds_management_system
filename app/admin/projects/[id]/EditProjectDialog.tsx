'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import { updateProject } from '@/app/data/actions'
import { Database } from '@/utils/supabase/types'

type Project = Database['public']['Tables']['projects']['Row']

export default function EditProjectDialog({ project }: { project: Project }) {
    const [open, setOpen] = useState(false)
    const [isPending, startTransition] = useTransition()
    const router = useRouter()

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const formData = new FormData(e.currentTarget)
        startTransition(async () => {
            const result = await updateProject(project.id, formData)
            if (result.error) {
                toast.error(`Błąd: ${result.error}`)
            } else {
                toast.success('Projekt został zaktualizowany')
                setOpen(false)
                router.refresh()
            }
        })
    }

    return (
        <>
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" /> Edytuj
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edytuj projekt</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Nazwa</Label>
                            <Input id="name" name="name" defaultValue={project.name} required />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="project_code">Kod projektu</Label>
                            <Input id="project_code" name="project_code" defaultValue={project.project_code || ''} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="description">Opis</Label>
                            <Input id="description" name="description" defaultValue={project.description || ''} />
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="is_active_check"
                                name="is_active"
                                value="true"
                                defaultChecked={project.is_active ?? true}
                                className="h-4 w-4"
                            />
                            <Label htmlFor="is_active_check">Projekt aktywny</Label>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                                Anuluj
                            </Button>
                            <Button type="submit" disabled={isPending}>
                                {isPending ? 'Zapisuję...' : 'Zapisz'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    )
}
