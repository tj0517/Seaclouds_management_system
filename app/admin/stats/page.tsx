import { getAdminStats } from '@/app/data/actions/stats'
import { BarChart3, Users, FolderOpen, Clock, CheckSquare } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export default async function StatsPage() {
  const stats = await getAdminStats()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <BarChart3 className="h-8 w-8 text-primary" /> Statystyki
        </h2>
        <p className="text-muted-foreground mt-1">
          Przegląd aktywności w systemie.
        </p>
      </div>

      {/* Karty podsumowania */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Projekty</CardTitle>
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.projectsCount}</div>
            <p className="text-xs text-muted-foreground">łącznie projektów</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pracownicy</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.usersCount}</div>
            <p className="text-xs text-muted-foreground">zarejestrowanych użytkowników</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Godziny (ten miesiąc)</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalHoursThisMonth}</div>
            <p className="text-xs text-muted-foreground">przepracowanych godzin</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Zatwierdzenia (ten miesiąc)</CardTitle>
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalSubmissionsThisMonth}</div>
            <p className="text-xs text-muted-foreground">zatwierdzonych tygodni</p>
          </CardContent>
        </Card>
      </div>

      {/* Godziny według projektu */}
      <Card>
        <CardHeader>
          <CardTitle>Godziny według projektu</CardTitle>
          <CardDescription>Zestawienie godzin w bieżącym miesiącu.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.hoursPerProject.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Brak danych w bieżącym miesiącu.
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Projekt</TableHead>
                    <TableHead className="text-right">Godziny</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.hoursPerProject.map((row) => (
                    <TableRow key={row.name}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-right font-bold text-blue-600">{row.hours}h</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
