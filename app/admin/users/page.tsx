import { getUsers } from '@/app/data/actions'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import UsersTable from '@/app/components/UsersTable'

export default async function UsersPage() {
  const users = await getUsers()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Pracownicy</h2>
          <p className="text-muted-foreground mt-1">
            Zarządzaj kontami pracowników i ich uprawnieniami.
          </p>
        </div>
      </div>

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
    </div>
  )
}