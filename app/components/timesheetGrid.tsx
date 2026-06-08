'use client'

import { useRouter } from 'next/navigation'

import { useState, useEffect } from 'react'
import { format, addDays } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { saveWorkEntry, copyWeek, submitWeekAll, saveContractCode } from '@/app/data/actions'
import { Loader2, AlertCircle, ChevronRight, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Fragment } from 'react'
import SubmitWeekButton from './SubmitWeekButton'
import { Button } from '@/components/ui/button'


type Project = { id: string; name: string, project_code: string | null }
type SubProject = { id: string; code: string; description: string | null; project_id: string; tracking_type?: string }
type Entry = { sub_project_id: string; work_date: string; hours: number | null }

export default function TimesheetGrid({
  projects,
  subProjects,
  existingEntries,
  weekStart,
  initialSubmissionStatus,
  initialContractCodes
}: {
  projects: Project[],
  subProjects: SubProject[],
  existingEntries: Entry[],
  weekStart: Date,
  initialSubmissionStatus: Record<string, boolean>,
  initialContractCodes: Record<string, string>
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  const initialData: Record<string, Record<string, number>> = {}
  existingEntries.forEach(entry => {
    if (!initialData[entry.sub_project_id]) initialData[entry.sub_project_id] = {}
    initialData[entry.sub_project_id][entry.work_date] = entry.hours || 0
  })

  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})

  const toggleProject = (projectId: string) => {
    setExpandedProjects(prev => ({
      ...prev,
      [projectId]: !prev[projectId]
    }))
  }

  const [gridData, setGridData] = useState(initialData)

  useEffect(() => {
    const newData: Record<string, Record<string, number>> = {}
    existingEntries.forEach(entry => {
      if (!newData[entry.sub_project_id]) newData[entry.sub_project_id] = {}
      newData[entry.sub_project_id][entry.work_date] = entry.hours || 0
    })
    setGridData(newData)
  }, [existingEntries])

  const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i))

  const handleChange = (projectId: string, dateStr: string, value: string) => {
    let num = value === '' ? 0 : parseFloat(value)
    if (num < 0) num = 0

    setGridData(prev => ({
      ...prev,
      [projectId]: {
        ...prev[projectId],
        [dateStr]: isNaN(num) ? 0 : num
      }
    }))
  }

  const handleSave = async (subprojectId: string, dateStr: string, overrideHours?: number) => {
    const hours = overrideHours ?? gridData[subprojectId]?.[dateStr] ?? 0
    setSaving(true)
    const result = await saveWorkEntry(subprojectId, dateStr, hours)
    if (result && 'error' in result) {
      toast.error(result.error || 'Failed to save entry')
    }
    setSaving(false)
  }

  const dailyTotals = weekDays.map(day => {
    const dateStr = format(day, 'yyyy-MM-dd')
    return subProjects
      .filter(sp => sp.tracking_type !== 'days')
      .reduce((acc, sp) => {
        return acc + (gridData[sp.id]?.[dateStr] || 0)
      }, 0)
  })

  const weeklyTotal = dailyTotals.reduce((acc, val) => acc + val, 0)

  const [submittedProjects, setSubmittedProjects] = useState<Record<string, boolean>>(initialSubmissionStatus)

  const [contractCodes, setContractCodes] = useState<Record<string, string>>(initialContractCodes)

  const handleContractCodeSave = async (projectId: string, code: string) => {
    setContractCodes(prev => ({ ...prev, [projectId]: code }))
    setSaving(true)
    const result = await saveContractCode(projectId, format(weekStart, 'yyyy-MM-dd'), code)
    if (result && 'error' in result) {
      toast.error(result.error || 'Failed to save contract code')
    }
    setSaving(false)
  }

  const isProjectFullySubmitted = (projectId: string) => {
    const pSubs = subProjects.filter(sp => sp.project_id === projectId)
    return pSubs.length > 0 && pSubs.every(sp => submittedProjects[sp.id])
  }

  const unsubmittedIds = subProjects
    .filter(sp => !submittedProjects[sp.id])
    .map(sp => sp.id)

  const projectSubProjects = projects.reduce((acc, project) => {
    acc[project.id] = subProjects.filter(sp => sp.project_id === project.id)
    return acc
  }, {} as Record<string, SubProject[]>)

  return (
    <div className="relative">
      {/* Save status */}
      <div className="absolute top-[-30px] right-0 h-6 flex items-center justify-end min-w-[100px]">
        {saving ? (
          <span className="text-xs text-blue-600 flex items-center gap-1">
            <Loader2 className="animate-spin h-3 w-3" /> Saving...
          </span>
        ) : (
          <span className="text-xs text-gray-400">All changes saved</span>
        )}
      </div>

      {/* ==================== DESKTOP TABLE ==================== */}
      <div className="hidden md:block overflow-x-auto bg-white rounded-lg shadow border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500 w-48 min-w-[180px]">Project</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 min-w-[140px]">Kod umowy</th>
              {weekDays.map(day => {
                const isWeekend = day.getDay() === 0 || day.getDay() === 6
                return (
                  <th key={day.toString()} className={`px-2 py-3 text-center font-medium w-24 ${isWeekend ? 'text-red-400' : 'text-gray-500'}`}>
                    <div className="text-xs uppercase">{format(day, 'EEE', { locale: enUS })}</div>
                    <div className="text-gray-900">{format(day, 'dd.MM')}</div>
                  </th>
                )
              })}
              <th className="px-4 py-3 text-center font-bold text-gray-700 w-20 bg-gray-100">Σ</th>
              <th className="px-4 py-3 text-center font-medium text-gray-500 min-w-[150px]">Status</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-200">
            {projects.map(project => {
              const pSubProjects = projectSubProjects[project.id] || []
              const isExpanded = expandedProjects[project.id]

              const hoursSubProjects = pSubProjects.filter(sp => sp.tracking_type !== 'days')
              const daysSubProjects = pSubProjects.filter(sp => sp.tracking_type === 'days')
              const projectDailyTotals = weekDays.map(day => {
                const dateStr = format(day, 'yyyy-MM-dd')
                return hoursSubProjects.reduce((acc, sp) => {
                  return acc + (gridData[sp.id]?.[dateStr] || 0)
                }, 0)
              })
              const projectDailyDays = weekDays.map(day => {
                const dateStr = format(day, 'yyyy-MM-dd')
                return daysSubProjects.reduce((acc, sp) => {
                  return acc + ((gridData[sp.id]?.[dateStr] ?? 0) >= 1 ? 1 : 0)
                }, 0)
              })
              const projectWeeklyTotal = projectDailyTotals.reduce((a, b) => a + b, 0)
              const projectWeeklyDays = projectDailyDays.reduce((a, b) => a + b, 0)

              return (
                <Fragment key={project.id}>
                  <tr className="bg-gray-100/50 hover:bg-gray-100 cursor-pointer" onClick={() => toggleProject(project.id)}>
                    <td className="px-4 py-3 font-semibold text-gray-800 flex items-center gap-2">
                      <span className={`transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                      {project.name}
                    </td>
                    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        placeholder="Kod umowy"
                        disabled={isProjectFullySubmitted(project.id)}
                        className="w-full h-8 px-2 text-xs rounded border border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                        value={contractCodes[project.id] || ''}
                        onChange={(e) => setContractCodes(prev => ({ ...prev, [project.id]: e.target.value }))}
                        onBlur={(e) => handleContractCodeSave(project.id, e.target.value)}
                      />
                    </td>
                    {projectDailyTotals.map((total, idx) => {
                      const days = projectDailyDays[idx]
                      const hasHours = total > 0
                      const hasDays = days > 0
                      return (
                        <td key={idx} className="px-1 py-3 text-center text-xs font-medium text-gray-500 bg-gray-50/50">
                          {hasHours || hasDays ? (
                            <div className="flex flex-col items-center">
                              {hasHours && <span>{total}</span>}
                              {hasDays && <span className="text-purple-600">{days}d</span>}
                            </div>
                          ) : '-'}
                        </td>
                      )
                    })}
                    <td className="px-4 py-3 text-center font-bold text-gray-700 bg-gray-100">
                      <div className="flex flex-col items-center">
                        {projectWeeklyTotal > 0 && <span>{projectWeeklyTotal}</span>}
                        {projectWeeklyDays > 0 && <span className="text-purple-600 text-xs">{projectWeeklyDays}d</span>}
                        {projectWeeklyTotal === 0 && projectWeeklyDays === 0 && '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center border-l border-gray-200">
                      -
                    </td>
                  </tr>

                  {isExpanded && pSubProjects.map(subProject => {
                    const isDays = subProject.tracking_type === 'days'
                    const rowTotal = weekDays.reduce((acc, day) => {
                      const dateStr = format(day, 'yyyy-MM-dd')
                      return acc + (gridData[subProject.id]?.[dateStr] || 0)
                    }, 0)

                    return (
                      <tr key={subProject.id} className="hover:bg-gray-50 group transition-colors">
                        <td className="px-4 py-2 pl-8 text-sm text-gray-600" title={subProject.description || ''}>
                          <span className="font-mono text-xs text-blue-700 font-semibold">{subProject.code}</span>
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500 truncate max-w-[180px]" title={subProject.description || ''}>
                          {subProject.description || 'No description'}
                        </td>
                        {weekDays.map(day => {
                          const dateStr = format(day, 'yyyy-MM-dd')
                          const hours = gridData[subProject.id]?.[dateStr]
                          const isWeekend = day.getDay() === 0 || day.getDay() === 6
                          const bgClass = isWeekend ? 'bg-gray-50' : 'bg-white'

                          if (isDays) {
                            const isChecked = (hours ?? 0) >= 1
                            return (
                              <td key={dateStr} className={`p-1 border-l border-gray-100 ${bgClass}`}>
                                <div className="flex items-center justify-center h-8">
                                  {submittedProjects[subProject.id] ? (
                                    <span className={`text-sm ${isChecked ? 'text-emerald-600 font-bold' : 'text-gray-300'}`}>
                                      {isChecked ? '✓' : '-'}
                                    </span>
                                  ) : (
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                      onChange={(e) => {
                                        const newHours = e.target.checked ? 1 : 0
                                        handleChange(subProject.id, dateStr, String(newHours))
                                        handleSave(subProject.id, dateStr, newHours)
                                      }}
                                    />
                                  )}
                                </div>
                              </td>
                            )
                          }

                          return (
                            <td key={dateStr} className={`p-1 border-l border-gray-100 ${bgClass}`}>
                              <input
                                type="number"
                                min="0"
                                max="24"
                                step="0.5"
                                disabled={submittedProjects[subProject.id]}
                                className={`w-full h-8 text-center text-sm rounded border-transparent hover:border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all ${bgClass} ${hours && hours > 12 ? 'text-red-600 font-bold' : ''} disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed`}
                                value={!hours ? '' : hours}
                                placeholder="-"
                                onChange={(e) => handleChange(subProject.id, dateStr, e.target.value)}
                                onBlur={() => handleSave(subProject.id, dateStr)}
                              />
                            </td>
                          )
                        })}
                        <td className="px-4 py-2 text-center font-bold text-blue-600 bg-gray-50 border-l border-gray-200">
                          {rowTotal > 0 ? `${rowTotal}${isDays ? 'd' : ''}` : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-2 text-center border-l border-gray-200">
                          {submittedProjects[subProject.id] ? (
                            <span className="text-green-600">Submitted</span>
                          ) : (
                            <SubmitWeekButton
                              weekStart={format(weekStart, 'yyyy-MM-dd')}
                              subprojectId={subProject.id}
                              isSubmitted={submittedProjects[subProject.id] || false}
                              onSuccess={() => {
                                setSubmittedProjects(prev => ({
                                  ...prev,
                                  [subProject.id]: true
                                }))
                              }}
                            />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}

            {projects.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-12 text-center text-gray-500">
                  <div className="flex flex-col items-center gap-2">
                    <AlertCircle className="h-8 w-8 text-gray-400" />
                    <p>No assigned projects.</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>

          <tfoot className="bg-gray-100 font-bold text-gray-900 border-t-2 border-gray-200">
            <tr>
              <td className="px-4 py-3 text-right text-gray-500 text-xs uppercase tracking-wider"></td>
              <td className="px-4 py-3 text-gray-500 text-xs uppercase tracking-wider">Total:</td>
              {dailyTotals.map((total, index) => {
                const isOverworked = total > 12
                return (
                  <td key={index} className={`px-2 py-3 text-center border-l border-gray-200 ${isOverworked ? 'text-red-600' : ''}`}>
                    {total > 0 ? total : '-'}
                  </td>
                )
              })}
              <td className="px-4 py-3 text-center bg-blue-50 text-blue-700 text-lg border-l border-gray-300">
                {weeklyTotal > 0 ? weeklyTotal : '-'}
              </td>
              <td className="px-4 py-3 text-center border-l border-gray-200">
                <div className="flex flex-col gap-2 items-center">
                  {unsubmittedIds.length > 0 && (
                    <Button
                      onClick={async () => {
                        setSaving(true)
                        const result = await submitWeekAll(format(weekStart, 'yyyy-MM-dd'), unsubmittedIds)
                        if (result && 'error' in result) {
                          toast.error(result.error)
                        } else {
                          toast.success('Week submitted for all projects')
                          const newStatus = { ...submittedProjects }
                          unsubmittedIds.forEach(id => { newStatus[id] = true })
                          setSubmittedProjects(newStatus)
                        }
                        router.refresh()
                        setSaving(false)
                      }}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      disabled={saving}
                      size="sm"
                    >
                      <Send className="mr-1 h-3 w-3" /> Submit All
                    </Button>
                  )}
                  <Button
                    onClick={async () => {
                      setSaving(true)
                      const result = await copyWeek(format(weekStart, 'yyyy-MM-dd'))
                      if (result && 'error' in result) {
                        toast.error(result.error)
                      } else {
                        toast.success('Copied entries from last week')
                      }
                      router.refresh()
                      setSaving(false)
                    }}
                    variant="outline"
                    className="bg-blue-50 hover:bg-blue-100 text-blue-600 border-blue-200"
                    disabled={saving}
                    size="sm"
                  >
                    Copy<br /> <span className="text-xs">(last week)</span>
                  </Button>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ==================== MOBILE VIEW ==================== */}
      <div className="md:hidden space-y-3">
        {projects.length === 0 && (
          <div className="bg-white rounded-lg shadow border border-gray-200 px-6 py-12 text-center text-gray-500">
            <div className="flex flex-col items-center gap-2">
              <AlertCircle className="h-8 w-8 text-gray-400" />
              <p>No assigned projects.</p>
            </div>
          </div>
        )}

        {projects.map(project => {
          const pSubProjects = projectSubProjects[project.id] || []
          const isExpanded = expandedProjects[project.id]

          const mobileHoursSubProjects = pSubProjects.filter(sp => sp.tracking_type !== 'days')
          const mobileDaysSubProjects = pSubProjects.filter(sp => sp.tracking_type === 'days')
          const projectWeeklyTotal = weekDays.reduce((acc, day) => {
            const dateStr = format(day, 'yyyy-MM-dd')
            return acc + mobileHoursSubProjects.reduce((a, sp) => a + (gridData[sp.id]?.[dateStr] || 0), 0)
          }, 0)
          const mobileWeeklyDays = weekDays.reduce((acc, day) => {
            const dateStr = format(day, 'yyyy-MM-dd')
            return acc + mobileDaysSubProjects.reduce((a, sp) => a + ((gridData[sp.id]?.[dateStr] ?? 0) >= 1 ? 1 : 0), 0)
          }, 0)

          return (
            <div key={project.id}>
              {/* Project header */}
              <button
                onClick={() => toggleProject(project.id)}
                className="w-full flex items-center justify-between bg-white rounded-lg shadow border border-gray-200 px-4 py-3"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ChevronRight className={`h-4 w-4 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  <span className="font-semibold text-gray-800 truncate">{project.name}</span>
                  {project.project_code && (
                    <span className="text-xs font-mono text-gray-400 flex-shrink-0">{project.project_code}</span>
                  )}
                </div>
                <span className="text-sm font-bold text-gray-600 flex-shrink-0 ml-2">
                  {projectWeeklyTotal > 0 ? `${projectWeeklyTotal}h` : ''}
                  {projectWeeklyTotal > 0 && mobileWeeklyDays > 0 ? ' · ' : ''}
                  {mobileWeeklyDays > 0 ? <span className="text-purple-600">{mobileWeeklyDays}d</span> : ''}
                  {projectWeeklyTotal === 0 && mobileWeeklyDays === 0 ? '-' : ''}
                </span>
              </button>

              {/* Contract code + Sub-project cards */}
              {isExpanded && (
                <div className="mt-2 space-y-2 pl-2">
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-3 py-2 flex items-center gap-2">
                    <label className="text-xs text-gray-500 whitespace-nowrap">Kod umowy:</label>
                    <input
                      type="text"
                      placeholder="Wpisz kod umowy"
                      disabled={isProjectFullySubmitted(project.id)}
                      className="flex-1 h-8 px-2 text-sm rounded border border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                      value={contractCodes[project.id] || ''}
                      onChange={(e) => setContractCodes(prev => ({ ...prev, [project.id]: e.target.value }))}
                      onBlur={(e) => handleContractCodeSave(project.id, e.target.value)}
                    />
                  </div>
                  {pSubProjects.map(subProject => {
                    const isDisabled = submittedProjects[subProject.id]
                    const mobileIsDays = subProject.tracking_type === 'days'
                    const rowTotal = weekDays.reduce((acc, day) => {
                      const dateStr = format(day, 'yyyy-MM-dd')
                      return acc + (gridData[subProject.id]?.[dateStr] || 0)
                    }, 0)

                    return (
                      <div
                        key={subProject.id}
                        className={`bg-white rounded-lg shadow-sm border ${isDisabled ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-200'}`}
                      >
                        {/* Sub-project header */}
                        <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                          <div className="min-w-0">
                            <div className="text-xs font-mono text-blue-700 font-semibold">{subProject.code}</div>
                            <div className="text-xs text-gray-500 truncate">{subProject.description || 'No description'}</div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <span className="text-sm font-bold text-blue-600">{rowTotal > 0 ? `${rowTotal}${mobileIsDays ? 'd' : 'h'}` : '-'}</span>
                          </div>
                        </div>

                        {/* Day inputs - 2 column grid */}
                        <div className="grid grid-cols-2 gap-px bg-gray-100 p-px">
                          {weekDays.map(day => {
                            const dateStr = format(day, 'yyyy-MM-dd')
                            const hours = gridData[subProject.id]?.[dateStr]
                            const isWeekend = day.getDay() === 0 || day.getDay() === 6

                            return (
                              <div
                                key={dateStr}
                                className={`flex items-center justify-between px-3 py-2 ${isWeekend ? 'bg-gray-50' : 'bg-white'}`}
                              >
                                <span className={`text-xs font-medium ${isWeekend ? 'text-red-400' : 'text-gray-500'}`}>
                                  {format(day, 'EEE', { locale: enUS })} {format(day, 'dd.MM')}
                                </span>
                                {mobileIsDays ? (
                                  isDisabled ? (
                                    <span className={`text-sm ${(hours ?? 0) >= 1 ? 'text-emerald-600 font-bold' : 'text-gray-300'}`}>
                                      {(hours ?? 0) >= 1 ? '✓' : '-'}
                                    </span>
                                  ) : (
                                    <input
                                      type="checkbox"
                                      checked={(hours ?? 0) >= 1}
                                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                      onChange={(e) => {
                                        const newHours = e.target.checked ? 1 : 0
                                        handleChange(subProject.id, dateStr, String(newHours))
                                        handleSave(subProject.id, dateStr, newHours)
                                      }}
                                    />
                                  )
                                ) : (
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    max="24"
                                    step="0.5"
                                    disabled={isDisabled}
                                    className={`w-14 h-8 text-center text-sm rounded border border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${isWeekend ? 'bg-gray-50' : 'bg-white'} ${hours && hours > 12 ? 'text-red-600 font-bold' : ''} disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed`}
                                    value={!hours ? '' : hours}
                                    placeholder="-"
                                    onChange={(e) => handleChange(subProject.id, dateStr, e.target.value)}
                                    onBlur={() => handleSave(subProject.id, dateStr)}
                                  />
                                )}
                              </div>
                            )
                          })}
                        </div>

                        {/* Submit row */}
                        <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-end">
                          {submittedProjects[subProject.id] ? (
                            <span className="text-xs text-emerald-600 font-medium">Submitted</span>
                          ) : (
                            <SubmitWeekButton
                              weekStart={format(weekStart, 'yyyy-MM-dd')}
                              subprojectId={subProject.id}
                              isSubmitted={submittedProjects[subProject.id] || false}
                              onSuccess={() => {
                                setSubmittedProjects(prev => ({
                                  ...prev,
                                  [subProject.id]: true
                                }))
                              }}
                            />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {/* Mobile footer: total + actions */}
        <div className="bg-white rounded-lg shadow border border-gray-200 px-4 py-3 flex items-center justify-between">
          <div>
            <span className="text-xs text-gray-500 uppercase tracking-wide">Week total</span>
            <div className="text-xl font-bold text-blue-700">{weeklyTotal > 0 ? `${weeklyTotal}h` : '-'}</div>
          </div>
          <div className="flex gap-2">
            {unsubmittedIds.length > 0 && (
              <Button
                onClick={async () => {
                  setSaving(true)
                  const result = await submitWeekAll(format(weekStart, 'yyyy-MM-dd'), unsubmittedIds)
                  if (result && 'error' in result) {
                    toast.error(result.error)
                  } else {
                    toast.success('Week submitted for all projects')
                    const newStatus = { ...submittedProjects }
                    unsubmittedIds.forEach(id => { newStatus[id] = true })
                    setSubmittedProjects(newStatus)
                  }
                  router.refresh()
                  setSaving(false)
                }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={saving}
                size="sm"
              >
                <Send className="mr-1 h-3 w-3" /> Submit All
              </Button>
            )}
            <Button
              onClick={async () => {
                setSaving(true)
                const result = await copyWeek(format(weekStart, 'yyyy-MM-dd'))
                if (result && 'error' in result) {
                  toast.error(result.error)
                } else {
                  toast.success('Copied entries from last week')
                }
                router.refresh()
                setSaving(false)
              }}
              variant="outline"
              className="bg-blue-50 hover:bg-blue-100 text-blue-600 border-blue-200"
              disabled={saving}
              size="sm"
            >
              Copy (last week)
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
