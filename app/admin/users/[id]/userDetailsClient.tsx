'use client'

import { toast } from "sonner"

import AssignmentCheckbox from './assignmentCheckbox'
import Link from 'next/link'
import { ArrowLeft, ShieldCheck, Pencil, UserX } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog'
import { useState, useTransition } from 'react'
import { Database } from '@/utils/supabase/types'
import { updateUserRole, deactivateUser } from '@/app/data/actions'

type Profile = Database['public']['Tables']['profiles']['Row']
type Project = Database['public']['Tables']['projects']['Row']

interface UserDetailsClientProps {
    currentUser: Profile | undefined
    userId: string
    projects: Project[]
    assignedProjectIds: string[]
}

export default function UserDetailsClient({
    currentUser,
    userId,
    projects,
    assignedProjectIds
}: UserDetailsClientProps) {
    const [isEditing, setIsEditing] = useState(false)
    const [isPending, startTransition] = useTransition()
    const [deactivateOpen, setDeactivateOpen] = useState(false)

    const handleDeactivate = () => {
        startTransition(async () => {
            const result = await deactivateUser(userId)
            if (result.error) {
                toast.error(`Błąd: ${result.error}`)
            } else {
                toast.success('Usunięto wszystkie przypisania pracownika')
            }
            setDeactivateOpen(false)
        })
    }

    const changeRole = () => {
        setIsEditing(false)
        startTransition(async () => {
            const result = await updateUserRole(userId, currentUser?.role === 'employee' ? 'admin' : 'employee')
            if (result.error) {
                toast.error(`Błąd zmiany roli: ${result.error}`)
            } else {
                toast.success('Rola została zmieniona')
            }
        })
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" asChild>
                    <Link href="/admin/users">
                        <ArrowLeft className="mr-2 h-4 w-4" /> Powrót
                    </Link>
                </Button>
                <h2 className="text-3xl font-bold tracking-tight">Edycja Uprawnień</h2>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
                {/* Karta Pracownika */}
                <div className="md:col-span-1">
                    <Card>
                        <CardHeader className="flex flex-row items-center gap-4">
                            <Avatar className="h-12 w-12">
                                <AvatarImage src="" />
                                <AvatarFallback className="text-lg bg-primary/10 text-primary">
                                    {currentUser?.full_name?.charAt(0) || 'U'}
                                </AvatarFallback>
                            </Avatar>
                            <div>
                                <CardTitle className="text-lg">{currentUser?.full_name || 'Użytkownik'}</CardTitle>
                                <CardDescription className="text-xs font-mono">{userId}</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center justify-between text-sm mt-2">
                                <span className="text-muted-foreground flex items-center gap-2">
                                    <ShieldCheck className="h-4 w-4" /> Rola:
                                </span>
                                <Badge variant={currentUser?.role === 'admin' ? "default" : "secondary"}>
                                    {currentUser?.role || 'employee'}
                                </Badge>
                                <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                                    <div className='flex flex-row'>
                                        <Pencil className="mr-2 h-4 w-4" /> Edytuj</div >
                                </Button>
                            </div>
                            {isEditing && (
                                <div className='flex flex-row gap-2'>
                                    <Button variant="default" className='w-1/2 mt-4' onClick={() => changeRole()}>
                                        <div > Zmień rolę </div>

                                    </Button>
                                    <Button variant="outline" className='w-1/2 mt-4' onClick={() => setIsEditing(false)}>
                                        <div > Anuluj </div>

                                    </Button>
                                </div>
                            )}

                            <div className="pt-4 border-t mt-4">
                                <Button variant="destructive" size="sm" className="w-full" onClick={() => setDeactivateOpen(true)}>
                                    <UserX className="mr-2 h-4 w-4" /> Usuń pracownika
                                </Button>
                            </div>

                        </CardContent>
                    </Card>
                </div>

                {/* Lista Projektów */}
                <div className="md:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Dostęp do Projektów</CardTitle>
                            <CardDescription>
                                Zaznacz projekty, w których ten pracownik może rejestrować czas pracy.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {projects?.map((project) => {
                                    const isAssigned = assignedProjectIds.includes(project.id)

                                    return (
                                        <div key={project.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/5 transition-colors">
                                            <div className="flex flex-col">
                                                <span className="font-medium text-sm">{project.name}</span>
                                                <span className="text-xs text-muted-foreground">
                                                    {project.is_active ? 'Aktywny' : 'Zakończony'}
                                                </span>
                                            </div>
                                            <AssignmentCheckbox
                                                userId={userId}
                                                projectId={project.id}
                                                initialChecked={isAssigned}
                                            />
                                        </div>
                                    )
                                })}

                                {projects?.length === 0 && (
                                    <div className="text-center py-8 text-muted-foreground text-sm">
                                        Brak projektów w systemie.
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>

        <Dialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Usuń pracownika</DialogTitle>
                    <DialogDescription>
                        Czy na pewno chcesz usunąć pracownika <strong>{currentUser?.full_name || 'tego użytkownika'}</strong>?
                        Zostaną usunięte wszystkie przypisania do projektów. Wpisy czasu pracy pozostaną w systemie.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setDeactivateOpen(false)} disabled={isPending}>
                        Anuluj
                    </Button>
                    <Button variant="destructive" onClick={handleDeactivate} disabled={isPending}>
                        {isPending ? 'Usuwam...' : 'Usuń pracownika'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
