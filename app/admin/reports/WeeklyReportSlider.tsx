'use client'

import { useMemo, useState, useCallback } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { ChevronLeft, ChevronRight, CheckCircle2, Undo2, Loader2, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { adminWithdrawSubmission } from '@/app/data/actions/timesheet'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

function RejectReasonTooltip({ reason }: { reason: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="ml-1.5 inline-flex items-center justify-center h-5 w-5 rounded-full bg-red-100 hover:bg-red-200 transition-colors">
          <Info className="h-4 w-4 text-red-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-64 text-sm p-3">
        <p className="font-medium text-red-700 mb-1">Rejection reason:</p>
        <p className="text-gray-700">{reason}</p>
      </PopoverContent>
    </Popover>
  )
}

export type UserRow = {
  userId: string
  userName: string
  subProjectId: string
  submissionStatus: 'submitted' | 'rejected' | 'pending'
  rejectReason: string | null
  trackingType?: 'hours' | 'days'
  dailyHours: Record<string, number>
  weekTotal: number
  earnings: number
  serviceOrder: string
}

export type SubProjectData = {
  code: string
  subProjectId: string
  description: string | null
  trackingType?: 'hours' | 'days'
  users: UserRow[]
}

export type ProjectData = {
  name: string
  code: string | null
  serviceOrder?: string
  subProjects: SubProjectData[]
  weekTotal: number
  weekTotalHours: number
  weekTotalDays: number
  dailyTotals: Record<string, number>
  dailyTotalsHours: Record<string, number>
  dailyTotalsDays: Record<string, number>
}

export type WeekData = {
  weekStart: string
  weekStartLabel: string
  weekEndLabel: string
  days: { key: string; dayName: string; dateLabel: string; isWeekend: boolean }[]
  projects: ProjectData[]
  weekTotal: number
  weekTotalHours: number
  weekTotalDays: number
}

type ViewMode = 'day' | 'week' | 'month'

// Aggregated data for the week summary view
type AggregatedUser = {
  userName: string
  weeklyHours: Record<string, number> // weekStart -> hours
  total: number
  submissionStatus: 'submitted' | 'rejected' | 'pending'
  rejectReason: string | null
  earnings: number
  serviceOrders: Record<string, string> // weekStart -> serviceOrder
}

type AggregatedSubProject = {
  code: string
  description: string | null
  trackingType?: 'hours' | 'days'
  users: AggregatedUser[]
}

type AggregatedProject = {
  name: string
  code: string | null
  serviceOrders?: Record<string, string> // weekStart -> contractCode
  subProjects: AggregatedSubProject[]
  weeklyTotals: Record<string, number> // weekStart -> hours
  weeklyTotalsHours: Record<string, number>
  weeklyTotalsDays: Record<string, number>
  total: number
  totalHours: number
  totalDays: number
}

function buildAggregatedProjects(weeks: WeekData[]): AggregatedProject[] {
  const projectMap = new Map<string, {
    code: string | null
    serviceOrders: Record<string, string>
    subProjectMap: Map<string, {
      description: string | null
      trackingType?: 'hours' | 'days'
      userMap: Map<string, { weeklyHours: Record<string, number>; total: number; submissionStatus: 'submitted' | 'rejected' | 'pending'; rejectReason: string | null; earnings: number; serviceOrders: Record<string, string> }>
    }>
    weeklyTotals: Record<string, number>
    weeklyTotalsHours: Record<string, number>
    weeklyTotalsDays: Record<string, number>
    total: number
    totalHours: number
    totalDays: number
  }>()

  for (const week of weeks) {
    for (const project of week.projects) {
      let pEntry = projectMap.get(project.name)
      if (!pEntry) {
        pEntry = { code: project.code, serviceOrders: {}, subProjectMap: new Map(), weeklyTotals: {}, weeklyTotalsHours: {}, weeklyTotalsDays: {}, total: 0, totalHours: 0, totalDays: 0 }
        projectMap.set(project.name, pEntry)
      }
      if (project.serviceOrder) {
        pEntry.serviceOrders[week.weekStart] = project.serviceOrder
      }
      pEntry.weeklyTotals[week.weekStart] = (pEntry.weeklyTotals[week.weekStart] ?? 0) + project.weekTotal
      pEntry.weeklyTotalsHours[week.weekStart] = (pEntry.weeklyTotalsHours[week.weekStart] ?? 0) + project.weekTotalHours
      pEntry.weeklyTotalsDays[week.weekStart] = (pEntry.weeklyTotalsDays[week.weekStart] ?? 0) + project.weekTotalDays
      pEntry.total += project.weekTotal
      pEntry.totalHours += project.weekTotalHours
      pEntry.totalDays += project.weekTotalDays

      for (const sp of project.subProjects) {
        let spEntry = pEntry.subProjectMap.get(sp.code)
        if (!spEntry) {
          spEntry = { description: sp.description, trackingType: sp.trackingType, userMap: new Map() }
          pEntry.subProjectMap.set(sp.code, spEntry)
        }

        for (const user of sp.users) {
          let uEntry = spEntry.userMap.get(user.userName)
          if (!uEntry) {
            uEntry = { weeklyHours: {}, total: 0, submissionStatus: 'submitted', rejectReason: null, earnings: 0, serviceOrders: {} }
            spEntry.userMap.set(user.userName, uEntry)
          }
          uEntry.weeklyHours[week.weekStart] = (uEntry.weeklyHours[week.weekStart] ?? 0) + user.weekTotal
          uEntry.total += user.weekTotal
          uEntry.earnings += user.earnings
          if (user.serviceOrder) uEntry.serviceOrders[week.weekStart] = user.serviceOrder
          if (user.rejectReason) uEntry.rejectReason = user.rejectReason
          // Aggregate status: rejected > pending > submitted (worst wins)
          if (user.submissionStatus === 'rejected') {
            uEntry.submissionStatus = 'rejected'
          } else if (user.submissionStatus === 'pending' && uEntry.submissionStatus !== 'rejected') {
            uEntry.submissionStatus = 'pending'
          }
        }
      }
    }
  }

  return Array.from(projectMap.entries()).map(([name, p]) => ({
    name,
    code: p.code,
    serviceOrders: p.serviceOrders,
    total: p.total,
    totalHours: p.totalHours,
    totalDays: p.totalDays,
    weeklyTotals: p.weeklyTotals,
    weeklyTotalsHours: p.weeklyTotalsHours,
    weeklyTotalsDays: p.weeklyTotalsDays,
    subProjects: Array.from(p.subProjectMap.entries()).map(([code, sp]) => ({
      code,
      description: sp.description,
      trackingType: sp.trackingType,
      users: Array.from(sp.userMap.entries()).map(([userName, u]) => ({
        userName,
        weeklyHours: u.weeklyHours,
        total: u.total,
        submissionStatus: u.submissionStatus,
        rejectReason: u.rejectReason,
        earnings: u.earnings,
        serviceOrders: u.serviceOrders,
      })),
    })),
  }))
}

function StatusCell({ userRow, weekStart }: { userRow: UserRow; weekStart: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [localRejected, setLocalRejected] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  if (localRejected || userRow.submissionStatus === 'rejected') {
    return (
      <span className="inline-flex items-center">
        <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100">Rejected</Badge>
        {userRow.rejectReason && <RejectReasonTooltip reason={userRow.rejectReason} />}
      </span>
    )
  }

  if (userRow.submissionStatus === 'pending') {
    return <Badge variant="outline" className="text-amber-600 border-amber-300">Pending</Badge>
  }

  const handleReject = async () => {
    setLoading(true)
    const result = await adminWithdrawSubmission(userRow.userId, weekStart, userRow.subProjectId, rejectReason)
    setLoading(false)
    if (result.success) {
      setLocalRejected(true)
      setRejectOpen(false)
      setRejectReason('')
      toast.success(`Rejected submission for ${userRow.userName}`)
      router.refresh()
    } else if (result.error) {
      toast.error(result.error)
    }
  }

  return (
    <div className="flex items-center justify-center gap-1.5">
      <span className="inline-flex items-center">
        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
          <CheckCircle2 className="h-3 w-3 mr-1" /> Submitted
        </Badge>
        {userRow.rejectReason && <RejectReasonTooltip reason={userRow.rejectReason} />}
      </span>
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogTrigger asChild>
          <button
            title="Reject submission"
            className="text-amber-500 hover:text-amber-700 transition-colors"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Timesheet</DialogTitle>
            <DialogDescription>
              Reject the timesheet submission for <strong>{userRow.userName}</strong>, week starting {weekStart}. The employee will be notified and can resubmit.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason for rejection (optional)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AggregatedStatusBadge({ status, rejectReason }: { status: 'submitted' | 'rejected' | 'pending'; rejectReason?: string | null }) {
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center">
        <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100">Rejected</Badge>
        {rejectReason && <RejectReasonTooltip reason={rejectReason} />}
      </span>
    )
  }
  if (status === 'submitted') {
    return (
      <span className="inline-flex items-center">
        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
          <CheckCircle2 className="h-3 w-3 mr-1" /> Submitted
        </Badge>
        {rejectReason && <RejectReasonTooltip reason={rejectReason} />}
      </span>
    )
  }
  return <Badge variant="outline" className="text-amber-600 border-amber-300">Pending</Badge>
}

function formatMixedTotal(hours: number, days: number): string {
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (days > 0) parts.push(`${days}d`)
  return parts.length > 0 ? parts.join(' / ') : '—'
}

export default function WeeklyReportSlider({ weeks, showEmpty }: { weeks: WeekData[]; showEmpty?: boolean }) {
  const [currentWeekIndex, setCurrentWeekIndex] = useState(0)
  const [viewMode, setViewMode] = useState<ViewMode>('day')
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()

  const toggleShowEmpty = useCallback((checked: boolean) => {
    const params = new URLSearchParams(searchParams.toString())
    if (checked) {
      params.set('showEmpty', 'true')
    } else {
      params.delete('showEmpty')
    }
    router.push(`${pathname}?${params.toString()}`)
  }, [searchParams, pathname, router])

  const aggregatedProjects = useMemo(() => buildAggregatedProjects(weeks), [weeks])

  if (weeks.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          No entries found for the selected filters.
        </CardContent>
      </Card>
    )
  }

  const safeIndex = Math.min(currentWeekIndex, weeks.length - 1)
  const week = weeks[safeIndex]
  const totalHoursAllWeeks = weeks.reduce((s, w) => s + w.weekTotalHours, 0)
  const totalDaysAllWeeks = weeks.reduce((s, w) => s + w.weekTotalDays, 0)

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {viewMode === 'day' && (
            <>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={safeIndex === 0}
                onClick={() => setCurrentWeekIndex(i => i - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={safeIndex === weeks.length - 1}
                onClick={() => setCurrentWeekIndex(i => i + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <h3 className="text-lg font-semibold text-gray-800 ml-1">
                Week {week.weekStartLabel} — {week.weekEndLabel}
              </h3>
              <span className="text-sm text-muted-foreground">
                ({safeIndex + 1} of {weeks.length})
              </span>
              <Badge variant="outline" className="font-mono text-xs ml-1">
                {formatMixedTotal(week.weekTotalHours, week.weekTotalDays)} total
              </Badge>
            </>
          )}
          {(viewMode === 'week' || viewMode === 'month') && (
            <>
              <h3 className="text-lg font-semibold text-gray-800">
                {viewMode === 'month' ? 'Monthly' : ''} Summary — {weeks[0].weekStartLabel} to {weeks[weeks.length - 1].weekEndLabel}
              </h3>
              <Badge variant="outline" className="font-mono text-xs ml-1">
                {formatMixedTotal(totalHoursAllWeeks, totalDaysAllWeeks)} total
              </Badge>
            </>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Switch
            id="show-empty"
            checked={showEmpty ?? false}
            onCheckedChange={toggleShowEmpty}
          />
          <Label htmlFor="show-empty" className="text-xs text-muted-foreground cursor-pointer">
            Show empty submissions
          </Label>
        </div>
        <div className="flex border rounded-md overflow-hidden">
          <button
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              viewMode === 'day'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-accent'
            }`}
            onClick={() => setViewMode('day')}
          >
            Day
          </button>
          <button
            className={`px-3 py-1.5 text-xs font-medium transition-colors border-l ${
              viewMode === 'week'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-accent'
            }`}
            onClick={() => setViewMode('week')}
          >
            Week
          </button>
          <button
            className={`px-3 py-1.5 text-xs font-medium transition-colors border-l ${
              viewMode === 'month'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-accent'
            }`}
            onClick={() => setViewMode('month')}
          >
            Month
          </button>
        </div>
        </div>
      </div>

      {/* Content */}
      {viewMode === 'month' ? (
        // Month view: one table per project, no date columns — just totals
        aggregatedProjects.map(project => (
          <Card key={project.name}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <CardTitle className="text-base">{project.name}</CardTitle>
                {project.code && (
                  <Badge variant="outline" className="font-mono text-xs">{project.code}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-32">Code</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-40">Description</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-36">Service Order</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Employee</th>
                      <th className="text-center px-3 py-2 font-bold text-gray-800 bg-gray-100 w-16">Σ</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-600 w-24">Earnings</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-600 w-28">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {project.subProjects.map(sp =>
                      sp.users.map((user, idx) => {
                        const userServiceCodes = [...new Set(Object.values(user.serviceOrders ?? {}))].filter(Boolean)
                        const userServiceLabel = userServiceCodes.length > 0 ? userServiceCodes.join(', ') : '—'
                        return (
                        <tr key={`${sp.code}-${user.userName}`} className="hover:bg-gray-50">
                          {idx === 0 && (
                            <td className="px-3 py-2 font-mono text-xs text-blue-700 font-semibold align-top" rowSpan={sp.users.length}>
                              {sp.code}
                            </td>
                          )}
                          {idx === 0 && (
                            <td className="px-3 py-2 text-xs text-gray-500 align-top" rowSpan={sp.users.length}>
                              {sp.description || '—'}
                            </td>
                          )}
                          <td className="px-3 py-2 font-mono text-xs text-purple-700 font-semibold">
                            {userServiceLabel}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                                {user.userName.charAt(0)}
                              </div>
                              {user.userName}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center font-bold text-blue-600 bg-gray-50">{user.total}{sp.trackingType === 'days' ? 'd' : 'h'}</td>
                          <td className="px-3 py-2 text-center font-medium text-emerald-700">
                            {user.earnings > 0 ? `${user.earnings.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} PLN` : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <AggregatedStatusBadge status={user.submissionStatus} rejectReason={user.rejectReason} />
                          </td>
                        </tr>
                        )})
                    )}
                    {/* Project subtotal */}
                    <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                      <td colSpan={4} className="px-3 py-2 text-right text-xs text-gray-500 uppercase tracking-wide">Project Total</td>
                      <td className="px-3 py-2 text-center text-blue-700 bg-blue-50">
                        {formatMixedTotal(project.totalHours, project.totalDays)}
                      </td>
                      <td className="px-3 py-2 text-center text-emerald-700 bg-emerald-50 font-bold">
                        {project.subProjects.reduce((s, sp) => s + sp.users.reduce((us, u) => us + u.earnings, 0), 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} PLN
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))
      ) : viewMode === 'day' ? (
        // Day view: single week with daily columns, navigate with arrows
        week.projects.map(project => (
          <Card key={project.name}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <CardTitle className="text-base">{project.name}</CardTitle>
                {project.code && (
                  <Badge variant="outline" className="font-mono text-xs">{project.code}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-32">Code</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-40">Description</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-36">Service Order</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Employee</th>
                      {week.days.map(d => (
                        <th
                          key={d.key}
                          className={`text-center px-2 py-2 font-medium whitespace-nowrap ${d.isWeekend ? 'text-red-400 bg-red-50/50' : 'text-gray-600'}`}
                        >
                          <div className="text-[10px] uppercase">{d.dayName}</div>
                          <div className="text-xs">{d.dateLabel}</div>
                        </th>
                      ))}
                      <th className="text-center px-3 py-2 font-bold text-gray-800 bg-gray-100 w-16">Σ</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-600 w-24">Earnings</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-600 w-28">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {project.subProjects.map(sp =>
                      sp.users.map((userRow, idx) => (
                        <tr key={`${sp.code}-${userRow.userName}`} className="hover:bg-gray-50">
                          {idx === 0 && (
                            <td className="px-3 py-2 font-mono text-xs text-blue-700 font-semibold align-top" rowSpan={sp.users.length}>
                              {sp.code}
                            </td>
                          )}
                          {idx === 0 && (
                            <td className="px-3 py-2 text-xs text-gray-500 align-top" rowSpan={sp.users.length}>
                              {sp.description || '—'}
                            </td>
                          )}
                          <td className="px-3 py-2 font-mono text-xs text-purple-700 font-semibold">
                            {userRow.serviceOrder || '—'}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                                {userRow.userName.charAt(0)}
                              </div>
                              {userRow.userName}
                            </div>
                          </td>
                          {week.days.map(d => {
                            const unit = (userRow.trackingType ?? sp.trackingType) === 'days' ? 'd' : 'h'
                            return (
                              <td key={d.key} className={`px-2 py-2 text-center ${d.isWeekend ? 'bg-red-50/30' : ''}`}>
                                {userRow.dailyHours[d.key]
                                  ? <span className="font-medium text-gray-800">{userRow.dailyHours[d.key]}{unit}</span>
                                  : <span className="text-gray-300">—</span>}
                              </td>
                            )
                          })}
                          <td className="px-3 py-2 text-center font-bold text-blue-600 bg-gray-50">{userRow.weekTotal}{(userRow.trackingType ?? sp.trackingType) === 'days' ? 'd' : 'h'}</td>
                          <td className="px-3 py-2 text-center font-medium text-emerald-700">
                            {userRow.earnings > 0 ? `${userRow.earnings.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} PLN` : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <StatusCell userRow={userRow} weekStart={week.weekStart} />
                          </td>
                        </tr>
                      ))
                    )}
                    {/* Project subtotal */}
                    <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                      <td colSpan={4} className="px-3 py-2 text-right text-xs text-gray-500 uppercase tracking-wide">Project Total</td>
                      {week.days.map(d => {
                        const h = project.dailyTotalsHours[d.key] ?? 0
                        const dd = project.dailyTotalsDays[d.key] ?? 0
                        return (
                          <td key={d.key} className="px-2 py-2 text-center text-sm">
                            {(h > 0 || dd > 0) ? <span className="font-bold">{formatMixedTotal(h, dd)}</span> : <span className="text-gray-300">—</span>}
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 text-center text-blue-700 bg-blue-50">
                        {formatMixedTotal(project.weekTotalHours, project.weekTotalDays)}
                      </td>
                      <td className="px-3 py-2 text-center text-emerald-700 bg-emerald-50 font-bold">
                        {project.subProjects.reduce((s, sp) => s + sp.users.reduce((us, u) => us + u.earnings, 0), 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} PLN
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))
      ) : (
        // Week view: one table per project, one column per week
        aggregatedProjects.map(project => (
          <Card key={project.name}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <CardTitle className="text-base">{project.name}</CardTitle>
                {project.code && (
                  <Badge variant="outline" className="font-mono text-xs">{project.code}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-32">Code</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-40">Description</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600 w-36">Service Order</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Employee</th>
                      {weeks.map(w => (
                        <th key={w.weekStart} className="text-center px-2 py-2 font-medium text-gray-600 whitespace-nowrap">
                          <div className="text-xs">{w.weekStartLabel}</div>
                          <div className="text-xs">{w.weekEndLabel}</div>
                        </th>
                      ))}
                      <th className="text-center px-3 py-2 font-bold text-gray-800 bg-gray-100 w-16">Σ</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-600 w-24">Earnings</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-600 w-28">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {project.subProjects.map(sp =>
                      sp.users.map((user, idx) => {
                        const userServiceCodes = [...new Set(Object.values(user.serviceOrders ?? {}))].filter(Boolean)
                        const userServiceLabel = userServiceCodes.length > 0 ? userServiceCodes.join(', ') : '—'
                        return (
                        <tr key={`${sp.code}-${user.userName}`} className="hover:bg-gray-50">
                          {idx === 0 && (
                            <td className="px-3 py-2 font-mono text-xs text-blue-700 font-semibold align-top" rowSpan={sp.users.length}>
                              {sp.code}
                            </td>
                          )}
                          {idx === 0 && (
                            <td className="px-3 py-2 text-xs text-gray-500 align-top" rowSpan={sp.users.length}>
                              {sp.description || '—'}
                            </td>
                          )}
                          <td className="px-3 py-2 font-mono text-xs text-purple-700 font-semibold">
                            {userServiceLabel}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                                {user.userName.charAt(0)}
                              </div>
                              {user.userName}
                            </div>
                          </td>
                          {weeks.map(w => {
                            const h = user.weeklyHours[w.weekStart] ?? 0
                            const wUnit = sp.trackingType === 'days' ? 'd' : 'h'
                            return (
                              <td key={w.weekStart} className="px-2 py-2 text-center">
                                {h > 0
                                  ? <span className="font-medium text-gray-800">{h}{wUnit}</span>
                                  : <span className="text-gray-300">—</span>}
                              </td>
                            )
                          })}
                          <td className="px-3 py-2 text-center font-bold text-blue-600 bg-gray-50">{user.total}{sp.trackingType === 'days' ? 'd' : 'h'}</td>
                          <td className="px-3 py-2 text-center font-medium text-emerald-700">
                            {user.earnings > 0 ? `${user.earnings.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} PLN` : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <AggregatedStatusBadge status={user.submissionStatus} rejectReason={user.rejectReason} />
                          </td>
                        </tr>
                        )})
                    )}
                    {/* Project subtotal */}
                    <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                      <td colSpan={4} className="px-3 py-2 text-right text-xs text-gray-500 uppercase tracking-wide">Project Total</td>
                      {weeks.map(w => {
                        const h = project.weeklyTotalsHours[w.weekStart] ?? 0
                        const dd = project.weeklyTotalsDays[w.weekStart] ?? 0
                        return (
                          <td key={w.weekStart} className="px-2 py-2 text-center text-sm">
                            {(h > 0 || dd > 0) ? <span className="font-bold">{formatMixedTotal(h, dd)}</span> : <span className="text-gray-300">—</span>}
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 text-center text-blue-700 bg-blue-50">
                        {formatMixedTotal(project.totalHours, project.totalDays)}
                      </td>
                      <td className="px-3 py-2 text-center text-emerald-700 bg-emerald-50 font-bold">
                        {project.subProjects.reduce((s, sp) => s + sp.users.reduce((us, u) => us + u.earnings, 0), 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} PLN
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
