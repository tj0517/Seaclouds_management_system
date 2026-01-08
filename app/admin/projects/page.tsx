import { getProjects } from '@/app/data/actions'
import AddProjectForm from './addProjectForm'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { FolderKanban } from 'lucide-react'

export default async function ProjectsPage() {
  const projects = await getProjects()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Zarządzanie Projektami</h2>
          <p className="text-muted-foreground mt-1">
            Dodawaj nowe projekty i monitoruj ich status.
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Formularz - zajmuje 1 kolumnę na desktopie (lub w osobnej karcie) */}
        <div className="md:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FolderKanban className="h-5 w-5" /> Nowy Projekt
              </CardTitle>
              <CardDescription>Utwórz nowy projekt w systemie.</CardDescription>
            </CardHeader>
            <CardContent>
              <AddProjectForm />
            </CardContent>
          </Card>
        </div>

        {/* Lista projektów - zajmuje 2 kolumny */}
        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Lista Projektów</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nazwa</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projects?.map((project) => (
                      <TableRow key={project.id}>
                        <TableCell className="font-medium">{project.name}</TableCell>
                        <TableCell>
                          <Badge variant={project.is_active ? "default" : "destructive"} className={project.is_active ? "bg-emerald-600 hover:bg-emerald-700" : ""}>
                            {project.is_active ? 'Aktywny' : 'Zakończony'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground font-mono">
                          {project.id.slice(0, 8)}...
                        </TableCell>
                      </TableRow>
                    ))}

                    {projects?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                          Brak projektów. Dodaj pierwszy obok.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}