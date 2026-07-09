import { getAdminExpenseTableDetail, getExpenseEntries } from '@/app/data/actions/expenses'
import { getUserRoleAndProjects, hasProjectAccess } from '@/app/data/actions/auth-helpers'
import { redirect } from 'next/navigation'
import AdminExpenseDetail from './AdminExpenseDetail'

type Props = {
    params: Promise<{ id: string }>
}

export default async function AdminExpenseDetailPage(props: Props) {
    const { id } = await props.params
    const table = await getAdminExpenseTableDetail(id)

    if (!table) redirect('/admin/expenses')

    // Verify PM has access to this project
    const roleInfo = await getUserRoleAndProjects()
    if (roleInfo && !hasProjectAccess(roleInfo, table.project_id)) redirect('/admin/expenses')

    const entries = await getExpenseEntries(id)

    return <AdminExpenseDetail table={table} entries={entries} />
}
