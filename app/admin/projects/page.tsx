import { getProjects } from '@/app/data/actions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { Separator } from '@/components/ui/separator'
import ProjectsTable from '@/app/components/ProjectsTable'

export default async function ProjectsPage() {
  const projects = await getProjects()

  return (
    <div className="space-y-6">
      <div className="flex flex-row items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Zarządzanie Projektami</h2>
          <p className="text-muted-foreground mt-1">
            Dodawaj nowe projekty i monitoruj ich status.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/projects/new">Dodaj Projekt</Link>
        </Button>
      </div>
      <Separator />

      {/* Lista projektów - zajmuje 2 kolumny */}
      <div className="md:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Lista Projektów</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectsTable projects={projects} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}