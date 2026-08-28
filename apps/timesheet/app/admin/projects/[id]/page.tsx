import { getProjectById, getUsers, getProjectAssignments, fetchSubProjects, getSubProjectAssignments } from '@/app/data/actions'
import { getUserRoleAndProjects, hasProjectAccess } from '@/app/data/actions/auth-helpers'
import { redirect } from 'next/navigation'
import AssignedEmployeesTable from './AssignedEmployeesTable'
import SubProjectsList from './SubProjectsList'
import EditProjectDialog from './EditProjectDialog'
import DeleteProjectButton from './DeleteProjectButton'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export default async function ProjectDetailsPage({
    params
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    const projectId = id

    const roleInfo = await getUserRoleAndProjects()
    if (!roleInfo) redirect('/login')
    if (!hasProjectAccess(roleInfo, projectId)) redirect('/admin/projects')

    const isAdmin = roleInfo.role === 'admin'

    const [project, users, assignedUserIds, subProjects] = await Promise.all([
        getProjectById(projectId),
        getUsers(),
        getProjectAssignments(projectId),
        fetchSubProjects(projectId)
    ])

    const subProjectIds = subProjects.map(sp => sp.id)
    const subProjectAssignments = await getSubProjectAssignments(subProjectIds)

    const assignedUsers = users.filter(u => assignedUserIds.includes(u.id))

    if (!project) {
        return (
            <div className="p-8 text-center text-muted-foreground">
                Project not found. <Link href="/admin/projects" className="underline">Back to list.</Link>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" asChild>
                    <Link href="/admin/projects">
                        <ArrowLeft className="mr-2 h-4 w-4" /> Back
                    </Link>
                </Button>
                <h2 className="text-3xl font-bold tracking-tight">Project Details</h2>
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
                                <span className="text-muted-foreground">Status</span>
                                <Badge variant={project.is_active ? "default" : "destructive"} className={project.is_active ? "bg-emerald-600" : ""}>
                                    {project.is_active ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
                                    {project.is_active ? 'Active' : 'Completed'}
                                </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground">
                                <p className="font-medium mb-1 text-gray-700">Description:</p>
                                <p>{project.description || 'No description.'}</p>
                            </div>
                            {isAdmin && (
                                <div className="flex gap-2 pt-2">
                                    <EditProjectDialog project={project} />
                                    <DeleteProjectButton projectId={project.id} projectName={project.name} />
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Lista Pracowników — only admins can assign/unassign users from projects */}
                {isAdmin && (
                    <div className="md:col-span-2">
                        <Card>
                            <CardHeader>
                                <CardTitle>Assigned Employees</CardTitle>
                                <CardDescription>
                                    Select employees who have access to this project.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <AssignedEmployeesTable
                                    users={users}
                                    projectId={projectId}
                                    assignedUserIds={assignedUserIds}
                                />
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>

            {/* Lista Podprojektów */}
            <div className="md:col-span-3">
                <SubProjectsList
                    projectId={projectId}
                    initialSubProjects={subProjects}
                    assignedUsers={assignedUsers}
                    subProjectAssignments={subProjectAssignments}
                    isAdmin={isAdmin}
                />
            </div>
        </div>
    )
}
