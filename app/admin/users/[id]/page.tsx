import { getProjects, getUserAssignments, getUsers } from '@/app/data/actions'
import AssignmentCheckbox from './assignmentCheckbox'
import Link from 'next/link'
import { ArrowLeft, User, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

export default async function UserDetailsPage({
  params
}: {
  params: Promise<{ id: string }>
}) {

  const { id } = await params;
  const userId = id;

  const [projects, assignedProjectIds, users] = await Promise.all([
    getProjects(),
    getUserAssignments(userId),
    getUsers()
  ])

  const currentUser = users.find(u => u.id === userId)

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
                  {currentUser?.role || 'worker'}
                </Badge>
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
  )
}