import { format } from 'date-fns'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, FileText, Receipt } from 'lucide-react'
import {
    getUserMonthDetail,
    getMonthlyEarnings,
    getStatusesForMonth,
    getEarningsDocUrls,
} from '@/app/data/actions/earnings'
import StatusSelect from '../StatusSelect'

function fmt(amount: number) {
    return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: 2 }).format(amount)
}

function fmtNum(n: number) {
    return new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)
}

export default async function UserEarningDetailPage({
    params,
    searchParams,
}: {
    params: Promise<{ userId: string }>
    searchParams: Promise<{ month?: string }>
}) {
    const { userId } = await params
    const { month: rawMonth } = await searchParams
    const month = rawMonth ?? format(new Date(), 'yyyy-MM')

    const [detail, allRows, allStatuses] = await Promise.all([
        getUserMonthDetail(userId, month),
        getMonthlyEarnings(month),
        getStatusesForMonth(month),
    ])

    if (!detail) notFound()

    const s = allRows.find(r => r.user_id === userId)

    // Collect all receipt paths for signed-URL generation
    const allReceiptPaths = detail.expenses.flatMap(e => e.receipt_paths)
    const docs = await getEarningsDocUrls(userId, month, allReceiptPaths)

    const tsHours = detail.timesheet.filter(l => l.tracking_type !== 'days')
    const tsDays  = detail.timesheet.filter(l => l.tracking_type === 'days')
    const totalHours   = tsHours.reduce((a, l) => a + l.value, 0)
    const totalDays    = tsDays.reduce((a, l) => a + l.value, 0)
    const totalExpenses = detail.expenses.reduce((a, e) => a + e.total_pln, 0)

    const rateH = s?.rate_hourly ?? null
    const rateD = s?.rate_daily ?? null

    // Compute per-line earnings for display
    function lineEarnings(trackingType: string, value: number): number {
        if (trackingType === 'days') {
            return rateD != null ? value * rateD : rateH != null ? value * 8 * rateH : 0
        } else {
            return rateH != null ? value * rateH : rateD != null ? (value / 8) * rateD : 0
        }
    }

    return (
        <div className="space-y-6">
            <Link
                href={`/admin/earnings?month=${month}`}
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
                <ArrowLeft className="h-4 w-4" /> Back
            </Link>

            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">{detail.user_name}</h2>
                    <p className="text-muted-foreground mt-1">{month}</p>
                </div>
                <div className="pt-1">
                    <StatusSelect userId={userId} yearMonth={month} status={allStatuses[userId] ?? 'pending'} />
                </div>
            </div>

            {/* Summary cards */}
            {s && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="bg-white border rounded-lg p-4 space-y-0.5">
                        <p className="text-xs text-gray-400 uppercase tracking-wide">Hours worked</p>
                        <p className="text-2xl font-semibold">{s.total_hours > 0 ? `${s.total_hours} h` : '—'}</p>
                        <p className="text-xs text-gray-400">{rateH != null ? `${rateH} PLN/h` : '—'}</p>
                    </div>
                    <div className="bg-white border rounded-lg p-4 space-y-0.5">
                        <p className="text-xs text-gray-400 uppercase tracking-wide">Earnings (hours)</p>
                        <p className="text-2xl font-semibold">{fmt(s.earnings_from_hours)}</p>
                    </div>
                    <div className="bg-white border rounded-lg p-4 space-y-0.5 border-purple-100">
                        <p className="text-xs text-purple-400 uppercase tracking-wide">Days worked</p>
                        <p className="text-2xl font-semibold text-purple-700">{s.total_days > 0 ? `${s.total_days} d` : '—'}</p>
                        <p className="text-xs text-purple-300">{rateD != null ? `${rateD} PLN/day` : '—'}</p>
                    </div>
                    <div className="bg-white border rounded-lg p-4 space-y-0.5 border-purple-100">
                        <p className="text-xs text-purple-400 uppercase tracking-wide">Earnings (days)</p>
                        <p className="text-2xl font-semibold text-purple-700">{fmt(s.earnings_from_days)}</p>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-0.5">
                        <p className="text-xs text-blue-400 uppercase tracking-wide">Sum</p>
                        <p className="text-2xl font-semibold text-blue-600">{fmt(s.sum_pln)}</p>
                        <p className="text-xs text-blue-300">
                            {fmt(s.earnings_pln)} + {fmt(s.total_approved_expenses_pln)} exp.
                        </p>
                    </div>
                </div>
            )}

            {/* Timesheet breakdown with rates */}
            <div className="bg-white rounded-lg border shadow-sm">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                    <h3 className="font-semibold">Timesheet Breakdown</h3>
                    {docs.timesheetPdfUrl && (
                        <a
                            href={docs.timesheetPdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium"
                        >
                            <FileText className="h-4 w-4" /> Timesheet PDF
                        </a>
                    )}
                </div>
                {detail.timesheet.length === 0 ? (
                    <p className="text-sm text-muted-foreground px-6 py-6 text-center">No timesheet entries for {month}.</p>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                            <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                                <th colSpan={2} className="px-6 py-2" />
                                <th colSpan={3} className="px-4 py-2 text-center border-l border-gray-200">Hours</th>
                                <th colSpan={3} className="px-4 py-2 text-center border-l border-gray-200 text-purple-400">Days</th>
                            </tr>
                            <tr>
                                <th className="text-left px-6 py-3 font-medium">Project</th>
                                <th className="text-left px-6 py-3 font-medium">Sub-project</th>
                                <th className="text-right px-4 py-3 font-medium border-l border-gray-200">Worked</th>
                                <th className="text-right px-4 py-3 font-medium text-gray-400">Rate</th>
                                <th className="text-right px-4 py-3 font-medium">Earnings</th>
                                <th className="text-right px-4 py-3 font-medium border-l border-gray-200 text-purple-600">Worked</th>
                                <th className="text-right px-4 py-3 font-medium text-purple-400">Rate</th>
                                <th className="text-right px-4 py-3 font-medium text-purple-600">Earnings</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {detail.timesheet.map((line, i) => {
                                const isHours = line.tracking_type !== 'days'
                                const effectiveRate = isHours
                                    ? (rateH ?? (rateD != null ? rateD / 8 : null))
                                    : (rateD ?? (rateH != null ? rateH * 8 : null))
                                const earnings = lineEarnings(line.tracking_type, line.value)
                                return (
                                    <tr key={i} className="hover:bg-gray-50">
                                        <td className="px-6 py-3">{line.project_name}</td>
                                        <td className="px-6 py-3 text-gray-500">{line.sub_project_code}</td>
                                        {/* Hours cols */}
                                        <td className="px-4 py-3 text-right font-mono border-l border-gray-200">
                                            {isHours ? `${fmtNum(line.value)} h` : <span className="text-gray-300">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-right text-xs text-gray-400">
                                            {isHours && effectiveRate != null ? `${fmtNum(effectiveRate)} PLN/h` : <span className="text-gray-300">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono">
                                            {isHours ? fmt(earnings) : <span className="text-gray-300">—</span>}
                                        </td>
                                        {/* Days cols */}
                                        <td className="px-4 py-3 text-right font-mono text-purple-700 border-l border-gray-200">
                                            {!isHours ? `${fmtNum(line.value)} d` : <span className="text-gray-300">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-right text-xs text-purple-400">
                                            {!isHours && effectiveRate != null ? `${fmtNum(effectiveRate)} PLN/d` : <span className="text-gray-300">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-purple-700">
                                            {!isHours ? fmt(earnings) : <span className="text-gray-300">—</span>}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                        <tfoot>
                            <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                                <td className="px-6 py-3" colSpan={2}>Total</td>
                                <td className="px-4 py-3 text-right font-mono border-l border-gray-200">
                                    {totalHours > 0 ? `${fmtNum(totalHours)} h` : '—'}
                                </td>
                                <td />
                                <td className="px-4 py-3 text-right font-mono">
                                    {s && s.earnings_from_hours > 0 ? fmt(s.earnings_from_hours) : '—'}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-purple-700 border-l border-gray-200">
                                    {totalDays > 0 ? `${fmtNum(totalDays)} d` : '—'}
                                </td>
                                <td />
                                <td className="px-4 py-3 text-right font-mono text-purple-700">
                                    {s && s.earnings_from_days > 0 ? fmt(s.earnings_from_days) : '—'}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                )}
            </div>

            {/* Approved expenses with receipts */}
            <div className="bg-white rounded-lg border shadow-sm">
                <div className="px-6 py-4 border-b">
                    <h3 className="font-semibold">Approved Expenses</h3>
                </div>
                {detail.expenses.length === 0 ? (
                    <p className="text-sm text-muted-foreground px-6 py-6 text-center">No approved expenses for {month}.</p>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                            <tr>
                                <th className="text-left px-6 py-3 font-medium">Purpose</th>
                                <th className="text-left px-6 py-3 font-medium">Date</th>
                                <th className="text-right px-6 py-3 font-medium">Total (PLN)</th>
                                <th className="px-6 py-3 font-medium">Receipts</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {detail.expenses.map((exp) => (
                                <tr key={exp.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-3">{exp.purpose ?? '—'}</td>
                                    <td className="px-6 py-3 text-gray-500">
                                        {exp.start_date}{exp.end_date && exp.end_date !== exp.start_date ? ` – ${exp.end_date}` : ''}
                                    </td>
                                    <td className="px-6 py-3 text-right font-mono">{fmt(exp.total_pln)}</td>
                                    <td className="px-6 py-3">
                                        <div className="flex flex-wrap gap-2">
                                            {exp.receipt_paths.length === 0 ? (
                                                <span className="text-gray-300 text-xs">—</span>
                                            ) : exp.receipt_paths.map((path, idx) => {
                                                const url = docs.receiptUrls[path]
                                                return url ? (
                                                    <a
                                                        key={idx}
                                                        href={url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                                                    >
                                                        <Receipt className="h-3.5 w-3.5" />
                                                        Receipt {exp.receipt_paths.length > 1 ? idx + 1 : ''}
                                                    </a>
                                                ) : null
                                            })}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                                <td className="px-6 py-3" colSpan={2}>Total</td>
                                <td className="px-6 py-3 text-right font-mono">{fmt(totalExpenses)}</td>
                                <td />
                            </tr>
                        </tfoot>
                    </table>
                )}
            </div>

            {/* Final summary */}
            {s && (
                <div className="bg-white border-2 border-blue-200 rounded-lg p-5 flex flex-wrap gap-6 items-center justify-between">
                    <div>
                        <span className="text-xs text-gray-400 uppercase tracking-wide">Total Earnings</span>
                        <p className="text-xl font-semibold">{fmt(s.earnings_pln)}</p>
                    </div>
                    <span className="text-2xl text-gray-300">+</span>
                    <div>
                        <span className="text-xs text-gray-400 uppercase tracking-wide">Approved Expenses</span>
                        <p className="text-xl font-semibold">{fmt(s.total_approved_expenses_pln)}</p>
                    </div>
                    <span className="text-2xl text-gray-300">=</span>
                    <div>
                        <span className="text-xs text-blue-400 uppercase tracking-wide">Sum</span>
                        <p className="text-2xl font-bold text-blue-600">{fmt(s.sum_pln)}</p>
                    </div>
                </div>
            )}
        </div>
    )
}
