'use client'

import { useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Eye, X, ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { MonthlyEarningRow, EarningStatus } from '@/app/data/actions/earnings'
import StatusSelect from './StatusSelect'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmt(amount: number) {
    return new Intl.NumberFormat('pl-PL', {
        style: 'currency',
        currency: 'PLN',
        minimumFractionDigits: 2,
    }).format(amount)
}

interface Props {
    month: string
    rows: MonthlyEarningRow[]
    statuses: Record<string, EarningStatus>
    projects: { id: string; name: string }[]
    selectedProject: string
}

export default function AdminEarningsClient({ month, rows, statuses, projects, selectedProject }: Props) {
    const router = useRouter()

    const [filterEmployee, setFilterEmployee] = useState('')
    const [filterStatus, setFilterStatus] = useState('')
    const [pickerOpen, setPickerOpen] = useState(false)
    const [pickerYear, setPickerYear] = useState(() => Number(month.split('-')[0]))

    function navigateMonth(offset: number) {
        const [y, m] = month.split('-').map(Number)
        const d = new Date(y, m - 1 + offset, 1)
        const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        const params = new URLSearchParams()
        params.set('month', next)
        if (selectedProject) params.set('project', selectedProject)
        router.push(`/admin/earnings?${params.toString()}`)
    }

    function pickMonth(m: number) {
        const next = `${pickerYear}-${String(m).padStart(2, '0')}`
        setPickerOpen(false)
        const params = new URLSearchParams()
        params.set('month', next)
        if (selectedProject) params.set('project', selectedProject)
        router.push(`/admin/earnings?${params.toString()}`)
    }

    const monthLabel = (() => {
        const [y, m] = month.split('-').map(Number)
        return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    })()

    // Build URL with month + project params
    function pushProjectFilter(projectId: string) {
        const params = new URLSearchParams()
        params.set('month', month)
        if (projectId) params.set('project', projectId)
        router.push(`/admin/earnings?${params.toString()}`)
    }

    const filtered = useMemo(() => {
        return rows.filter(r => {
            if (filterEmployee && r.user_id !== filterEmployee) return false
            // Project filter is now server-side, but still hide users with zero activity
            if (selectedProject && !r.project_ids.includes(selectedProject)) return false
            if (filterStatus) {
                const rowStatus = statuses[r.user_id] ?? 'pending'
                if (rowStatus !== filterStatus) return false
            }
            return true
        })
    }, [rows, statuses, filterEmployee, selectedProject, filterStatus])

    const totals = filtered.reduce(
        (acc, r) => ({
            hours: acc.hours + r.total_hours,
            days: acc.days + r.total_days,
            earnings_hours: acc.earnings_hours + r.earnings_from_hours,
            earnings_days: acc.earnings_days + r.earnings_from_days,
            earnings: acc.earnings + r.earnings_pln,
            expenses: acc.expenses + r.total_approved_expenses_pln,
            sum: acc.sum + r.sum_pln,
        }),
        { hours: 0, days: 0, earnings_hours: 0, earnings_days: 0, earnings: 0, expenses: 0, sum: 0 }
    )

    return (
        <div className="space-y-4">
            {/* Controls row */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center rounded-md border border-input bg-background">
                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-r-none" onClick={() => navigateMonth(-1)}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Popover open={pickerOpen} onOpenChange={(open) => { setPickerOpen(open); if (open) setPickerYear(Number(month.split('-')[0])) }}>
                        <PopoverTrigger asChild>
                            <button className="flex items-center gap-2 px-3 h-9 text-sm font-medium min-w-[160px] justify-center hover:bg-accent/50 transition-colors">
                                <Calendar className="h-4 w-4 text-muted-foreground" />
                                {monthLabel}
                            </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[240px] p-3" align="start">
                            <div className="flex items-center justify-between mb-2">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPickerYear(y => y - 1)}>
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <span className="text-sm font-semibold">{pickerYear}</span>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPickerYear(y => y + 1)}>
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                            <div className="grid grid-cols-3 gap-1">
                                {MONTH_NAMES.map((name, i) => {
                                    const m = i + 1
                                    const isActive = month === `${pickerYear}-${String(m).padStart(2, '0')}`
                                    return (
                                        <button
                                            key={m}
                                            onClick={() => pickMonth(m)}
                                            className={`px-2 py-1.5 text-xs rounded-md transition-colors ${
                                                isActive
                                                    ? 'bg-primary text-primary-foreground font-semibold'
                                                    : 'hover:bg-accent text-foreground'
                                            }`}
                                        >
                                            {name}
                                        </button>
                                    )
                                })}
                            </div>
                        </PopoverContent>
                    </Popover>
                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-l-none" onClick={() => navigateMonth(1)}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>

                <select
                    value={filterEmployee}
                    onChange={e => setFilterEmployee(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                    <option value="">All employees</option>
                    {rows.map(r => (
                        <option key={r.user_id} value={r.user_id}>{r.user_name}</option>
                    ))}
                </select>

                <select
                    value={selectedProject}
                    onChange={e => pushProjectFilter(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                    <option value="">All projects</option>
                    {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </select>

                <select
                    value={filterStatus}
                    onChange={e => setFilterStatus(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                    <option value="">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="submitted">Submitted</option>
                    <option value="paid">Paid</option>
                    <option value="declined">Declined</option>
                </select>

                {(filterEmployee || selectedProject || filterStatus) && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setFilterEmployee(''); setFilterStatus(''); pushProjectFilter('') }}
                    >
                        <X className="h-3 w-3" /> Clear filters
                    </Button>
                )}
            </div>

            <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
                {filtered.length === 0 ? (
                    <p className="text-sm text-muted-foreground px-6 py-10 text-center">
                        No results for the selected filters.
                    </p>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                            <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                                <th className="px-4 py-2" />
                                <th colSpan={3} className="px-4 py-2 text-center border-l border-gray-200">Hours</th>
                                <th colSpan={3} className="px-4 py-2 text-center border-l border-gray-200 text-purple-500">Days</th>
                                <th colSpan={3} className="px-4 py-2 text-center border-l border-gray-200">Summary</th>
                                <th className="px-4 py-2" />
                                <th className="px-4 py-2" />
                            </tr>
                            <tr>
                                <th className="text-left px-4 py-3 font-medium">Employee</th>
                                <th className="text-right px-4 py-3 font-medium border-l border-gray-200">Worked</th>
                                <th className="text-right px-4 py-3 font-medium">Rate</th>
                                <th className="text-right px-4 py-3 font-medium">Earnings</th>
                                <th className="text-right px-4 py-3 font-medium border-l border-gray-200 text-purple-600">Worked</th>
                                <th className="text-right px-4 py-3 font-medium text-purple-600">Rate</th>
                                <th className="text-right px-4 py-3 font-medium text-purple-600">Earnings</th>
                                <th className="text-right px-4 py-3 font-medium border-l border-gray-200">Total Earnings</th>
                                <th className="text-right px-4 py-3 font-medium">Expenses</th>
                                <th className="text-right px-4 py-3 font-medium">Sum</th>
                                <th className="px-4 py-3 font-medium">Status</th>
                                <th className="px-4 py-3" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filtered.map(r => (
                                <tr key={r.user_id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 font-medium whitespace-nowrap">{r.user_name}</td>
                                    {/* Hours */}
                                    <td className="px-4 py-3 text-right font-mono border-l border-gray-200">
                                        {r.total_hours > 0 ? `${r.total_hours} h` : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-500 text-xs">
                                        {r.rate_hourly != null ? `${r.rate_hourly} PLN` : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono">
                                        {r.earnings_from_hours > 0 ? fmt(r.earnings_from_hours) : <span className="text-gray-300">—</span>}
                                    </td>
                                    {/* Days */}
                                    <td className="px-4 py-3 text-right font-mono text-purple-700 border-l border-gray-200">
                                        {r.total_days > 0 ? `${r.total_days} d` : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right text-purple-500 text-xs">
                                        {r.rate_daily != null ? `${r.rate_daily} PLN` : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-purple-700">
                                        {r.earnings_from_days > 0 ? fmt(r.earnings_from_days) : <span className="text-gray-300">—</span>}
                                    </td>
                                    {/* Summary */}
                                    <td className="px-4 py-3 text-right font-mono border-l border-gray-200">{fmt(r.earnings_pln)}</td>
                                    <td className="px-4 py-3 text-right font-mono">{fmt(r.total_approved_expenses_pln)}</td>
                                    <td className="px-4 py-3 text-right font-mono font-semibold text-blue-600">{fmt(r.sum_pln)}</td>
                                    {/* Status */}
                                    <td className="px-4 py-3">
                                        <StatusSelect
                                            userId={r.user_id}
                                            yearMonth={month}
                                            status={statuses[r.user_id] ?? 'pending'}
                                        />
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <Button variant="ghost" size="sm" asChild>
                                            <Link href={`/admin/earnings/${r.user_id}?month=${month}`}>
                                                <Eye className="h-4 w-4" /> View
                                            </Link>
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                                <td className="px-4 py-3">Total ({filtered.length})</td>
                                <td className="px-4 py-3 text-right font-mono border-l border-gray-200">
                                    {totals.hours > 0 ? `${totals.hours} h` : '—'}
                                </td>
                                <td />
                                <td className="px-4 py-3 text-right font-mono">{fmt(totals.earnings_hours)}</td>
                                <td className="px-4 py-3 text-right font-mono text-purple-700 border-l border-gray-200">
                                    {totals.days > 0 ? `${totals.days} d` : '—'}
                                </td>
                                <td />
                                <td className="px-4 py-3 text-right font-mono text-purple-700">{fmt(totals.earnings_days)}</td>
                                <td className="px-4 py-3 text-right font-mono border-l border-gray-200">{fmt(totals.earnings)}</td>
                                <td className="px-4 py-3 text-right font-mono">{fmt(totals.expenses)}</td>
                                <td className="px-4 py-3 text-right font-mono text-blue-600">{fmt(totals.sum)}</td>
                                <td colSpan={2} />
                            </tr>
                            <tr>
                                <td colSpan={12} className="px-4 py-3 text-xs text-gray-400">
                                    Sum = Total Earnings + Approved Expenses. Project filter recalculates hours and earnings for that project only.
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                )}
            </div>
        </div>
    )
}
