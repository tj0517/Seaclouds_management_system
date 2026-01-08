import { getAdminStats, getProjects } from '@/app/data/actions'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import Link from 'next/link'
import { Table, TableBody, TableHead, TableHeader, TableRow, TableCell } from '@/components/ui/table'
import { getUsers } from '@/app/data/actions'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { UserCog } from 'lucide-react'

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
        <Card>
          <CardHeader>
            <CardTitle>Lista Pracowników</CardTitle>
            <CardDescription>
              Wszyscy użytkownicy zarejestrowani w systemie.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">Avatar</TableHead>
                    <TableHead>Pracownik</TableHead>
                    <TableHead>Rola</TableHead>
                    <TableHead className="text-right">Akcje</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <Avatar>
                          <AvatarImage src="" />
                          <AvatarFallback className="bg-primary/10 text-primary font-bold">
                            {user.full_name?.charAt(0) || 'U'}
                          </AvatarFallback>
                        </Avatar>
                      </TableCell>
                      <TableCell className="font-medium">
                        {user.full_name || 'Brak nazwy'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.role === 'admin' ? "default" : "secondary"}>
                          {user.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/admin/users/${user.id}`}>
                            <UserCog className="mr-2 h-4 w-4" /> Zarządzaj
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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