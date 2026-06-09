import { getAdminExpenseTableDetail, getExpenseEntries } from '@/app/data/actions/expenses'
import { redirect } from 'next/navigation'
import AdminExpenseDetail from './AdminExpenseDetail'

type Props = {
    params: Promise<{ id: string }>
}

export default async function AdminExpenseDetailPage(props: Props) {
    const { id } = await props.params
    const table = await getAdminExpenseTableDetail(id)

    if (!table) redirect('/admin/expenses')

    const entries = await getExpenseEntries(id)

    return <AdminExpenseDetail table={table} entries={entries} />
}
