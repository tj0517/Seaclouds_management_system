'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createSubProject, toggleSubProjectStatus } from '@/app/data/actions/projects'
import { Plus, CheckCircle2, XCircle, Ban } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

type SubProject = {
    id: string
    code: string
    description: string | null
    is_active: boolean | null
    project_id: string
}

export default function SubProjectsList({ projectId, initialSubProjects }: { projectId: string, initialSubProjects: SubProject[] }) {
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const router = useRouter()

    // Form states
    const [code, setCode] = useState('')
    const [description, setDescription] = useState('')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)

        const formData = new FormData()
        formData.append('project_id', projectId)
        formData.append('code', code)
        formData.append('description', description)

        const result = await createSubProject(formData)

        setLoading(false)
        if (result.success) {
            toast.success('Podprojekt został dodany')
            setOpen(false)
            setCode('')
            setDescription('')
            router.refresh()
        } else {
            toast.error(result.error || 'Błąd podczas dodawania podprojektu')
        }
    }

    const handleToggleStatus = async (id: string, currentStatus: boolean) => {
        const result = await toggleSubProjectStatus(id, projectId, !currentStatus)
        if (result.success) {
            toast.success(currentStatus ? 'Podprojekt dezaktywowany' : 'Podprojekt aktywowany')
            router.refresh()
        } else {
            toast.error(result.error || 'Błąd podczas zmiany statusu')
        }
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div>
                    <CardTitle>Podprojekty</CardTitle>
                    <CardDescription>Zarządzaj kodami zadań dla tego projektu.</CardDescription>
                </div>
                <Dialog open={open} onOpenChange={setOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm" className="gap-1">
                            <Plus size={16} /> Dodaj Podprojekt
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Dodaj nowy podprojekt</DialogTitle>
                            <DialogDescription>
                                Podprojekty pozwalają na bardziej szczegółowe raportowanie czasu.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="code">Kod / Nazwa (Wymagane)</Label>
                                <Input
                                    id="code"
                                    value={code}
                                    onChange={(e) => setCode(e.target.value)}
                                    placeholder="np. ANALIZA, DEV-001"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="description">Opis (Opcjonalne)</Label>
                                <Input
                                    id="description"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="np. Analiza wymagań biznesowych"
                                />
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Anuluj</Button>
                                <Button type="submit" disabled={loading}>{loading ? 'Dodawanie...' : 'Dodaj'}</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardHeader>
            <CardContent>
                {initialSubProjects.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm">
                        Brak zdefiniowanych podprojektów.
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[150px]">Kod</TableHead>
                                <TableHead>Opis</TableHead>
                                <TableHead className="w-[100px]">Status</TableHead>
                                <TableHead className="w-[100px] text-right">Akcje</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {initialSubProjects.map((sp) => (
                                <TableRow key={sp.id} className={sp.is_active ? '' : 'bg-muted/50'}>
                                    <TableCell className="font-medium">{sp.code}</TableCell>
                                    <TableCell className="text-muted-foreground">{sp.description || '-'}</TableCell>
                                    <TableCell>
                                        <Badge variant={sp.is_active ? "outline" : "secondary"} className={sp.is_active ? "text-green-600 border-green-200" : ""}>
                                            {sp.is_active ? 'Aktywny' : 'Nieaktywny'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            title={sp.is_active ? "Dezaktywuj" : "Aktywuj"}
                                            onClick={() => handleToggleStatus(sp.id, sp.is_active || false)}
                                        >
                                            {sp.is_active ? <Ban className="h-4 w-4 text-orange-500" /> : <CheckCircle2 className="h-4 w-4 text-green-600" />}
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    )
}
