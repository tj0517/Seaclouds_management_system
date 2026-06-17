'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Check, X, Eye, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
    AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { approveExpenseTable, declineExpenseTable } from '@/app/data/actions'
import type { AdminExpenseTable } from '@/app/data/actions/expenses'

const STATUS_TABS = [
    { value: 'all', label: 'All' },
    { value: 'submitted', label: 'Submitted' },
    { value: 'approved', label: 'Approved' },
    { value: 'declined', label: 'Declined' },
    { value: 'draft', label: 'Draft' },
] as const

function statusBadge(status: string) {
    switch (status) {
        case 'submitted': return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Submitted</Badge>
        case 'approved': return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Approved</Badge>
        case 'declined': return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Declined</Badge>
        default: return <Badge variant="secondary">Draft</Badge>
    }
}

function formatCurrency(amount: number) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'PLN',
        minimumFractionDigits: 2,
    }).format(amount)
}

export default function AdminExpensesTable({ tables }: { tables: AdminExpenseTable[] }) {
    const [statusFilter, setStatusFilter] = useState('all')
    const [employeeFilter, setEmployeeFilter] = useState('all')
    const [projectFilter, setProjectFilter] = useState('all')
    const [monthFilter, setMonthFilter] = useState('all')
    const [search, setSearch] = useState('')

    const employees = useMemo(() => {
        const names = [...new Set(tables.map(t => t.user_name))].sort()
        return names
    }, [tables])

    const projects = useMemo(() => {
        const names = [...new Set(tables.map(t => t.project_name))].sort()
        return names
    }, [tables])

    const months = useMemo(() => {
        const set = new Set<string>()
        for (const t of tables) {
            if (t.start_date) set.add(t.start_date.slice(0, 7))
        }
        return [...set].sort().reverse()
    }, [tables])

    const filtered = useMemo(() => {
        let result = tables
        if (statusFilter !== 'all') result = result.filter(t => t.status === statusFilter)
        if (employeeFilter !== 'all') result = result.filter(t => t.user_name === employeeFilter)
        if (projectFilter !== 'all') result = result.filter(t => t.project_name === projectFilter)
        if (monthFilter !== 'all') result = result.filter(t => t.start_date?.startsWith(monthFilter))
        if (search.trim()) {
            const q = search.toLowerCase()
            result = result.filter(t =>
                t.user_name.toLowerCase().includes(q) ||
                t.project_name.toLowerCase().includes(q) ||
                (t.purpose || '').toLowerCase().includes(q) ||
                (t.work_order || '').toLowerCase().includes(q)
            )
        }
        return result
    }, [tables, statusFilter, employeeFilter, projectFilter, monthFilter, search])

    const counts: Record<string, number> = { all: tables.length }
    for (const t of tables) {
        counts[t.status] = (counts[t.status] || 0) + 1
    }

    return (
        <div className="space-y-4">
            {/* Status tabs */}
            <div className="flex gap-2 flex-wrap">
                {STATUS_TABS.map(tab => (
                    <button
                        key={tab.value}
                        onClick={() => setStatusFilter(tab.value)}
                        className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                            statusFilter === tab.value
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                    >
                        {tab.label} {counts[tab.value] ? `(${counts[tab.value]})` : ''}
                    </button>
                ))}
            </div>

            {/* Filters row */}
            <div className="flex gap-3 flex-wrap items-center">
                <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="h-9 pl-8 pr-3 rounded-md border border-input bg-background text-sm w-48"
                    />
                </div>
                <select
                    value={employeeFilter}
                    onChange={e => setEmployeeFilter(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                    <option value="all">All employees</option>
                    {employees.map(name => (
                        <option key={name} value={name}>{name}</option>
                    ))}
                </select>
                <select
                    value={projectFilter}
                    onChange={e => setProjectFilter(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                    <option value="all">All projects</option>
                    {projects.map(name => (
                        <option key={name} value={name}>{name}</option>
                    ))}
                </select>
                <select
                    value={monthFilter}
                    onChange={e => setMonthFilter(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                    <option value="all">All months</option>
                    {months.map(m => (
                        <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}</option>
                    ))}
                </select>
                {(employeeFilter !== 'all' || projectFilter !== 'all' || monthFilter !== 'all' || search) && (
                    <button
                        onClick={() => { setEmployeeFilter('all'); setProjectFilter('all'); setMonthFilter('all'); setSearch('') }}
                        className="text-xs text-gray-500 hover:text-gray-700 underline"
                    >
                        Clear filters
                    </button>
                )}
            </div>

            {/* Table */}
            <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                {/* Desktop */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b bg-gray-50 text-left text-gray-500">
                                <th className="px-4 py-3 font-medium">Employee</th>
                                <th className="px-4 py-3 font-medium">Project</th>
                                <th className="px-4 py-3 font-medium">Date Range</th>
                                <th className="px-4 py-3 font-medium">Purpose</th>
                                <th className="px-4 py-3 font-medium text-right">Entries</th>
                                <th className="px-4 py-3 font-medium text-right">Total</th>
                                <th className="px-4 py-3 font-medium">Status</th>
                                <th className="px-4 py-3 font-medium text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(table => (
                                <TableRow key={table.id} table={table} />
                            ))}
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="text-center py-8 text-gray-400">No expense tables found</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Mobile */}
                <div className="md:hidden divide-y">
                    {filtered.map(table => (
                        <MobileTableCard key={table.id} table={table} />
                    ))}
                    {filtered.length === 0 && (
                        <p className="text-center py-8 text-gray-400 text-sm">No expense tables found</p>
                    )}
                </div>
            </div>
        </div>
    )
}

function TableRow({ table }: { table: AdminExpenseTable }) {
    const router = useRouter()
    const [approving, setApproving] = useState(false)
    const [declining, setDeclining] = useState(false)
    const [declineOpen, setDeclineOpen] = useState(false)
    const [declineReason, setDeclineReason] = useState('')

    const handleApprove = async () => {
        setApproving(true)
        const result = await approveExpenseTable(table.id)
        setApproving(false)
        if ('error' in result) toast.error(result.error)
        else { toast.success('Expense table approved'); router.refresh() }
    }

    const handleDecline = async () => {
        if (!declineReason.trim()) return
        setDeclining(true)
        const result = await declineExpenseTable(table.id, declineReason.trim())
        setDeclining(false)
        if ('error' in result) toast.error(result.error)
        else {
            toast.success('Expense table declined')
            setDeclineOpen(false)
            setDeclineReason('')
            router.refresh()
        }
    }

    return (
        <tr className="border-b last:border-b-0 hover:bg-gray-50">
            <td className="px-4 py-3">
                <div className="font-medium">{table.user_name}</div>
                <div className="text-xs text-gray-500">{table.user_email}</div>
            </td>
            <td className="px-4 py-3">{table.project_name}</td>
            <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                {table.start_date}{table.end_date ? ` — ${table.end_date}` : ''}
            </td>
            <td className="px-4 py-3 max-w-[200px] truncate text-gray-600">{table.purpose || '—'}</td>
            <td className="px-4 py-3 text-right">{table.entry_count}</td>
            <td className="px-4 py-3 text-right font-medium">{formatCurrency(table.total_amount)}</td>
            <td className="px-4 py-3">
                {statusBadge(table.status)}
                {table.status === 'declined' && table.decline_reason && (
                    <div className="text-xs text-red-600 mt-1 max-w-[200px] truncate" title={table.decline_reason}>
                        {table.decline_reason}
                    </div>
                )}
            </td>
            <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                    <Link href={`/admin/expenses/${table.id}`}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="View details">
                            <Eye size={16} />
                        </Button>
                    </Link>
                    {table.status === 'submitted' && (
                        <>
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50" title="Approve" disabled={approving}>
                                        {approving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Approve expense table?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            This will approve the expense table from {table.user_name} for {table.project_name}.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={handleApprove} className="bg-green-600 hover:bg-green-700">Approve</AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                            <Dialog open={declineOpen} onOpenChange={(open) => { setDeclineOpen(open); if (!open) setDeclineReason('') }}>
                                <DialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" title="Decline" disabled={declining}>
                                        {declining ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Decline expense table?</DialogTitle>
                                        <DialogDescription>Provide a reason so {table.user_name} knows what to fix. They will receive an email notification.</DialogDescription>
                                    </DialogHeader>
                                    <Textarea
                                        placeholder="Reason for declining..."
                                        value={declineReason}
                                        onChange={e => setDeclineReason(e.target.value)}
                                        rows={3}
                                    />
                                    <DialogFooter>
                                        <Button variant="outline" onClick={() => setDeclineOpen(false)}>Cancel</Button>
                                        <Button onClick={handleDecline} disabled={!declineReason.trim() || declining} className="bg-red-600 hover:bg-red-700">
                                            {declining && <Loader2 size={16} className="mr-2 animate-spin" />} Decline
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </>
                    )}
                </div>
            </td>
        </tr>
    )
}

function MobileTableCard({ table }: { table: AdminExpenseTable }) {
    const router = useRouter()
    const [approving, setApproving] = useState(false)
    const [declining, setDeclining] = useState(false)
    const [declineOpen, setDeclineOpen] = useState(false)
    const [declineReason, setDeclineReason] = useState('')

    const handleApprove = async () => {
        setApproving(true)
        const result = await approveExpenseTable(table.id)
        setApproving(false)
        if ('error' in result) toast.error(result.error)
        else { toast.success('Expense table approved'); router.refresh() }
    }

    const handleDecline = async () => {
        if (!declineReason.trim()) return
        setDeclining(true)
        const result = await declineExpenseTable(table.id, declineReason.trim())
        setDeclining(false)
        if ('error' in result) toast.error(result.error)
        else {
            toast.success('Expense table declined')
            setDeclineOpen(false)
            setDeclineReason('')
            router.refresh()
        }
    }

    return (
        <div className="p-4 space-y-2">
            <div className="flex justify-between items-start">
                <div>
                    <div className="font-medium">{table.user_name}</div>
                    <div className="text-xs text-gray-500">{table.project_name}</div>
                </div>
                {statusBadge(table.status)}
            </div>
            <div className="text-xs text-gray-500 space-y-0.5">
                <div>{table.start_date}{table.end_date ? ` — ${table.end_date}` : ''}</div>
                {table.purpose && <div>{table.purpose}</div>}
                <div>{table.entry_count} entries · {formatCurrency(table.total_amount)}</div>
            </div>
            {table.status === 'declined' && table.decline_reason && (
                <div className="p-2 rounded bg-red-50 border border-red-200 text-xs">
                    <span className="font-medium text-red-800">Reason:</span>{' '}
                    <span className="text-red-700">{table.decline_reason}</span>
                </div>
            )}
            <div className="flex items-center gap-2 pt-1">
                <Link href={`/admin/expenses/${table.id}`}>
                    <Button variant="outline" size="sm"><Eye size={14} className="mr-1" /> View</Button>
                </Link>
                {table.status === 'submitted' && (
                    <>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button size="sm" className="bg-green-600 hover:bg-green-700" disabled={approving}>
                                    {approving ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Check size={14} className="mr-1" />} Approve
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Approve expense table?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will approve the expense table from {table.user_name}.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleApprove} className="bg-green-600 hover:bg-green-700">Approve</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                        <Dialog open={declineOpen} onOpenChange={(open) => { setDeclineOpen(open); if (!open) setDeclineReason('') }}>
                            <DialogTrigger asChild>
                                <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50" disabled={declining}>
                                    {declining ? <Loader2 size={14} className="mr-1 animate-spin" /> : <X size={14} className="mr-1" />} Decline
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Decline expense table?</DialogTitle>
                                    <DialogDescription>Provide a reason so {table.user_name} knows what to fix. They will receive an email notification.</DialogDescription>
                                </DialogHeader>
                                <Textarea
                                    placeholder="Reason for declining..."
                                    value={declineReason}
                                    onChange={e => setDeclineReason(e.target.value)}
                                    rows={3}
                                />
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setDeclineOpen(false)}>Cancel</Button>
                                    <Button onClick={handleDecline} disabled={!declineReason.trim() || declining} className="bg-red-600 hover:bg-red-700">
                                        {declining && <Loader2 size={14} className="mr-1 animate-spin" />} Decline
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </>
                )}
            </div>
        </div>
    )
}
