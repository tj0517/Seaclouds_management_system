import { getReportData } from '@/app/data/actions'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { Download, Filter, FileText, Calendar } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

type Props = {
  searchParams: Promise<{ from?: string; to?: string }>
}

export default async function ReportsPage(props: Props) {
  const searchParams = await props.searchParams

  // Domyślne daty: Obecny miesiąc
  const today = new Date()
  const defaultFrom = format(startOfMonth(today), 'yyyy-MM-dd')
  const defaultTo = format(endOfMonth(today), 'yyyy-MM-dd')

  const dateFrom = searchParams.from || defaultFrom
  const dateTo = searchParams.to || defaultTo

  // Pobierz dane
  const entries = await getReportData(dateFrom, dateTo)

  // Oblicz sumę całkowitą
  const totalHours = entries.reduce((acc, curr) => acc + curr.hours, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-8 w-8 text-primary" /> Raporty
          </h2>
          <p className="text-muted-foreground mt-1">
            Przeglądaj i filtruj godziny pracy pracowników.
          </p>
        </div>
        <Button variant="outline" className="hidden sm:flex" disabled>
          <Download className="mr-2 h-4 w-4" /> Eksportuj CSV
        </Button>
      </div>

      {/* FILTRY */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Filtrowanie</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="w-full sm:w-auto">
              <label className="block text-sm font-medium mb-1 text-muted-foreground">Data od</label>
              <div className="relative">
                <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="date"
                  name="from"
                  defaultValue={dateFrom}
                  className="pl-9 w-full sm:w-[180px]"
                />
              </div>
            </div>
            <div className="w-full sm:w-auto">
              <label className="block text-sm font-medium mb-1 text-muted-foreground">Data do</label>
              <div className="relative">
                <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="date"
                  name="to"
                  defaultValue={dateTo}
                  className="pl-9 w-full sm:w-[180px]"
                />
              </div>
            </div>
            <Button type="submit" className="w-full sm:w-auto">
              <Filter className="mr-2 h-4 w-4" /> Filtruj
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* PODSUMOWANIE */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Suma godzin</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalHours}</div>
            <p className="text-xs text-muted-foreground">w wybranym okresie</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ilość wpisów</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{entries.length}</div>
            <p className="text-xs text-muted-foreground">zarejestrowanych zadań</p>
          </CardContent>
        </Card>
      </div>

      {/* TABELA DANYCH */}
      <Card>
        <CardHeader>
          <CardTitle>Szczegółowy wykaz</CardTitle>
          <CardDescription>Lista wpisów czasu pracy dla wybranych kryteriów.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Pracownik</TableHead>
                  <TableHead>Projekt</TableHead>
                  <TableHead className="text-right">Godziny</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">{entry.work_date}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">
                          {entry.profiles?.full_name?.charAt(0) || '?'}
                        </div>
                        {entry.profiles?.full_name || 'Brak danych'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">
                        {entry.projects?.name || 'Usunięty projekt'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-bold text-blue-600">
                      {entry.hours}h
                    </TableCell>
                  </TableRow>
                ))}
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                      Brak wpisów w wybranym zakresie dat.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}