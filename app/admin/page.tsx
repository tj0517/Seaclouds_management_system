import { getProjects, getUsers } from '@/app/data/actions'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import Link from 'next/link'
import ProjectsTable from '@/app/components/ProjectsTable'
import UsersTable from '@/app/components/UsersTable'

export default async function AdminDashboard() {
  const projects = await getProjects()
  const users = await getUsers()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Projekty</h2>
          <p className="text-muted-foreground mt-1">Zarządzaj aktywnymi projektami i przypisaniami.</p>
        </div>
        <Button asChild>
          <Link href="/admin/projects/new">Dodaj Projekt</Link>
        </Button>
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Lista Projektów</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectsTable projects={projects} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Lista Pracowników</CardTitle>
            <CardDescription>
              Wszyscy użytkownicy zarejestrowani w systemie.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UsersTable users={users} />
          </CardContent>
        </Card>


        {projects.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            Brak projektów. Dodaj pierwszy projekt!
          </div>
        )}
      </div>
    </div >
  )
}