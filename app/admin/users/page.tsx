import { getUsers } from '@/app/data/actions'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import UsersTable from '@/app/components/UsersTable'
import InviteUserDialog from './InviteUserDialog'

export default async function UsersPage() {
  const users = await getUsers()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Employees</h2>
          <p className="text-muted-foreground mt-1">
            Manage employee accounts and permissions.
          </p>
        </div>
        <InviteUserDialog />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Employees List</CardTitle>
          <CardDescription>
            All users registered in the system.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UsersTable users={users} />
        </CardContent>
      </Card>
    </div>
  )
}