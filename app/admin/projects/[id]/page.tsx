import { getProjectById, getUsers, getProjectAssignments, fetchSubProjects } from '@/app/data/actions'
import AssignmentCheckbox from './assignmentCheckbox'
import SubProjectsList from './SubProjectsList'
import EditProjectDialog from './EditProjectDialog'
import DeleteProjectButton from './DeleteProjectButton'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

export default async function ProjectDetailsPage({
    params
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    const projectId = id

    const [project, users, assignedUserIds, subProjects] = await Promise.all([
        getProjectById(projectId),
        getUsers(),
        getProjectAssignments(projectId),
        fetchSubProjects(projectId)
    ])

    if (!project) {
        return (
            <div className="p-8 text-center text-muted-foreground">
                Nie znaleziono projektu. <Link href="/admin/projects" className="underline">Wróć do listy.</Link>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" asChild>
                    <Link href="/admin/projects">
                        <ArrowLeft className="mr-2 h-4 w-4" /> Powrót
                    </Link>
                </Button>
                <h2 className="text-3xl font-bold tracking-tight">Szczegóły Projektu</h2>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
                {/* Karta Projektu */}
                <div className="md:col-span-1">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-xl">{project.name}</CardTitle>
                            <CardDescription className="font-mono text-xs">{project.project_code || project.id}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">Status:</span>
                                <Badge variant={project.is_active ? "default" : "destructive"} className={project.is_active ? "bg-emerald-600" : ""}>
                                    {project.is_active ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
                                    {project.is_active ? 'Aktywny' : 'Zakończony'}
                                </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground">
                                <p className="font-medium mb-1 text-gray-700">Opis:</p>
                                <p>{project.description || 'Brak opisu.'}</p>
                            </div>
                            <div className="flex gap-2 pt-2">
                                <EditProjectDialog project={project} />
                                <DeleteProjectButton projectId={project.id} projectName={project.name} />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Lista Pracowników */}
                <div className="md:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Przypisani Pracownicy</CardTitle>
                            <CardDescription>
                                Zaznacz pracowników, którzy mają dostęp do tego projektu.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {users.map((user) => {
                                    const isAssigned = assignedUserIds.includes(user.id)

                                    // Sortowanie: przypisani na górze
                                    // (Tu prosta pętla, ale można posortować tablicę users wcześniej)

                                    return (
                                        <div key={user.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/5 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <Avatar className="h-9 w-9">
                                                    <AvatarImage src="" />
                                                    <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                                        {user.full_name?.charAt(0) || 'U'}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <div className="flex flex-col">
                                                    <span className="font-medium text-sm">{user.full_name || 'Użytkownik'}</span>
                                                    <span className="text-xs text-muted-foreground">{user.role}</span>
                                                </div>
                                            </div>
                                            <AssignmentCheckbox
                                                userId={user.id}
                                                projectId={projectId}
                                                initialChecked={isAssigned}
                                            />
                                        </div>
                                    )
                                })}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Lista Podprojektów */}
            <div className="md:col-span-3">
                <SubProjectsList projectId={projectId} initialSubProjects={subProjects} />
            </div>
        </div>
    )
}
