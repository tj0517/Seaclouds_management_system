'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Check, X, Loader2, FileText, Car } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
    AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { approveExpenseTable, declineExpenseTable, getReceiptUrl } from '@/app/data/actions'
import type { ExpenseEntry } from '@/app/data/actions/expenses'

type TableDetail = {
    id: string
    user_id: string
    user_name: string
    user_email: string
    project_id: string
    project_name: string
    work_order: string | null
    purpose: string | null
    start_date: string
    end_date: string
    status: string
    created_at: string
    reviewed_at: string | null
    reviewed_by: string | null
}

const EXPENSE_TYPES: Record<string, string> = {
    taxi: 'Taxi', hotel: 'Hotel', meals: 'Meals', flight: 'Flight',
    parking: 'Parking', office_supplies: 'Office Supplies', personal_car: 'Personal Car', other: 'Other',
}

function formatCurrency(amount: number, currency: string) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency', currency, minimumFractionDigits: 2,
    }).format(amount)
}

function statusBadge(status: string) {
    switch (status) {
        case 'submitted': return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Submitted</Badge>
        case 'approved': return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Approved</Badge>
        case 'declined': return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Declined</Badge>
        default: return <Badge variant="secondary">Draft</Badge>
    }
}

export default function AdminExpenseDetail({ table, entries }: { table: TableDetail; entries: ExpenseEntry[] }) {
    const router = useRouter()
    const [approving, setApproving] = useState(false)
    const [declining, setDeclining] = useState(false)

    const handleApprove = async () => {
        setApproving(true)
        const result = await approveExpenseTable(table.id)
        setApproving(false)
        if ('error' in result) toast.error(result.error)
        else { toast.success('Expense table approved'); router.refresh() }
    }

    const handleDecline = async () => {
        setDeclining(true)
        const result = await declineExpenseTable(table.id)
        setDeclining(false)
        if ('error' in result) toast.error(result.error)
        else { toast.success('Expense table declined'); router.refresh() }
    }

    // Calculate totals by currency
    const totalsByCurrency: Record<string, number> = {}
    for (const entry of entries) {
        totalsByCurrency[entry.currency] = (totalsByCurrency[entry.currency] || 0) + Number(entry.amount)
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Link href="/admin/expenses">
                        <Button variant="ghost" size="icon"><ArrowLeft size={20} /></Button>
                    </Link>
                    <div>
                        <h2 className="text-2xl font-bold">Expense Table</h2>
                        <p className="text-sm text-muted-foreground">{table.user_name} — {table.project_name}</p>
                    </div>
                </div>
                {table.status === 'submitted' && (
                    <div className="flex items-center gap-2">
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button className="bg-green-600 hover:bg-green-700" disabled={approving}>
                                    {approving ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Check size={16} className="mr-2" />} Approve
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Approve expense table?</AlertDialogTitle>
                                    <AlertDialogDescription>This will approve the expense table from {table.user_name}.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleApprove} className="bg-green-600 hover:bg-green-700">Approve</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="outline" className="text-red-600 border-red-300 hover:bg-red-50" disabled={declining}>
                                    {declining ? <Loader2 size={16} className="mr-2 animate-spin" /> : <X size={16} className="mr-2" />} Decline
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Decline expense table?</AlertDialogTitle>
                                    <AlertDialogDescription>The employee can withdraw and resubmit after making changes.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleDecline} className="bg-red-600 hover:bg-red-700">Decline</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                )}
            </div>

            {/* Info card */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">Details {statusBadge(table.status)}</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                        <div>
                            <span className="text-muted-foreground">Employee</span>
                            <div className="font-medium">{table.user_name}</div>
                            <div className="text-xs text-gray-500">{table.user_email}</div>
                        </div>
                        <div>
                            <span className="text-muted-foreground">Project</span>
                            <div className="font-medium">{table.project_name}</div>
                        </div>
                        <div>
                            <span className="text-muted-foreground">Date Range</span>
                            <div className="font-medium">{table.start_date}{table.end_date ? ` — ${table.end_date}` : ''}</div>
                        </div>
                        {table.work_order && (
                            <div>
                                <span className="text-muted-foreground">Work Order</span>
                                <div className="font-medium">{table.work_order}</div>
                            </div>
                        )}
                        {table.purpose && (
                            <div>
                                <span className="text-muted-foreground">Purpose</span>
                                <div className="font-medium">{table.purpose}</div>
                            </div>
                        )}
                        <div>
                            <span className="text-muted-foreground">Total</span>
                            <div className="font-medium">
                                {Object.keys(totalsByCurrency).length > 0
                                    ? Object.entries(totalsByCurrency).map(([cur, amt]) => formatCurrency(amt, cur)).join(' + ')
                                    : '—'}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Entries table */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Entries ({entries.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    {/* Desktop */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b text-left text-gray-500">
                                    <th className="pb-2 pr-2 font-medium">Date</th>
                                    <th className="pb-2 pr-2 font-medium">Location</th>
                                    <th className="pb-2 pr-2 font-medium">Type</th>
                                    <th className="pb-2 pr-2 font-medium">Description</th>
                                    <th className="pb-2 pr-2 font-medium">Currency</th>
                                    <th className="pb-2 pr-2 font-medium text-right">Amount</th>
                                    <th className="pb-2 font-medium">Receipt</th>
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map(entry => (
                                    <ReadOnlyEntryRow key={entry.id} entry={entry} />
                                ))}
                                {entries.length === 0 && (
                                    <tr><td colSpan={7} className="text-center py-6 text-gray-400">No entries</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile */}
                    <div className="md:hidden space-y-3">
                        {entries.map(entry => (
                            <MobileEntryCard key={entry.id} entry={entry} />
                        ))}
                        {entries.length === 0 && (
                            <p className="text-center py-6 text-gray-400 text-sm">No entries</p>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

function ReadOnlyEntryRow({ entry }: { entry: ExpenseEntry }) {
    const [loadingUrl, setLoadingUrl] = useState(false)
    const isPersonalCar = entry.expense_type === 'personal_car'

    const handleView = async () => {
        setLoadingUrl(true)
        const result = await getReceiptUrl(entry.id)
        setLoadingUrl(false)
        if ('error' in result) toast.error(result.error)
        else if (result.url) window.open(result.url, '_blank')
    }

    const dateStr = entry.expense_date_end
        ? `${entry.expense_date} — ${entry.expense_date_end}`
        : entry.expense_date

    return (
        <tr className="border-b last:border-b-0 hover:bg-gray-50">
            <td className="py-2 pr-2 whitespace-nowrap">{dateStr}</td>
            <td className="py-2 pr-2">{entry.location || '—'}</td>
            <td className="py-2 pr-2 whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                    {isPersonalCar && <Car size={14} />}
                    {EXPENSE_TYPES[entry.expense_type] ?? entry.expense_type}
                </span>
            </td>
            <td className="py-2 pr-2 max-w-[200px] truncate">
                {isPersonalCar && entry.km != null && entry.km_rate != null
                    ? `${entry.km} km × ${entry.km_rate}/km`
                    : entry.description || '—'}
            </td>
            <td className="py-2 pr-2">{entry.currency}</td>
            <td className="py-2 pr-2 text-right font-medium">{formatCurrency(Number(entry.amount), entry.currency)}</td>
            <td className="py-2">
                {entry.receipt_path ? (
                    <Button variant="ghost" size="icon" onClick={handleView} disabled={loadingUrl} className="h-7 w-7 text-green-600" title="View receipt">
                        {loadingUrl ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                    </Button>
                ) : (
                    <span className="text-gray-300 text-xs">—</span>
                )}
            </td>
        </tr>
    )
}

function MobileEntryCard({ entry }: { entry: ExpenseEntry }) {
    const [loadingUrl, setLoadingUrl] = useState(false)
    const isPersonalCar = entry.expense_type === 'personal_car'

    const handleView = async () => {
        setLoadingUrl(true)
        const result = await getReceiptUrl(entry.id)
        setLoadingUrl(false)
        if ('error' in result) toast.error(result.error)
        else if (result.url) window.open(result.url, '_blank')
    }

    return (
        <div className="border rounded-lg p-3 space-y-2">
            <div className="flex justify-between items-start">
                <div>
                    <div className="font-medium text-sm flex items-center gap-1">
                        {isPersonalCar && <Car size={14} />}
                        {EXPENSE_TYPES[entry.expense_type] ?? entry.expense_type}
                    </div>
                    <div className="text-xs text-gray-500">
                        {entry.expense_date}{entry.expense_date_end ? ` — ${entry.expense_date_end}` : ''}
                        {entry.location && ` · ${entry.location}`}
                    </div>
                </div>
                <div className="text-right">
                    <div className="font-semibold text-sm">{formatCurrency(Number(entry.amount), entry.currency)}</div>
                    <div className="text-xs text-gray-500">{entry.currency}</div>
                </div>
            </div>
            {isPersonalCar && entry.km != null && entry.km_rate != null && (
                <div className="text-xs text-gray-600">{entry.km} km × {entry.km_rate}/km</div>
            )}
            {entry.description && !isPersonalCar && (
                <div className="text-xs text-gray-600">{entry.description}</div>
            )}
            {entry.receipt_path && (
                <Button variant="ghost" size="sm" onClick={handleView} disabled={loadingUrl} className="text-green-600">
                    {loadingUrl ? <Loader2 size={14} className="mr-1 animate-spin" /> : <FileText size={14} className="mr-1" />} View Receipt
                </Button>
            )}
        </div>
    )
}
