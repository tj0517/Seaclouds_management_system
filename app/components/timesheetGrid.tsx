'use client'

import { useRouter } from 'next/navigation'

import { useState, useEffect } from 'react'
import { format, addDays } from 'date-fns'
import { pl } from 'date-fns/locale'
import { saveWorkEntry, copyWeek } from '@/app/data/actions'
import { Loader2, AlertCircle } from 'lucide-react'
import SubmitWeekButton from './SubmitWeekButton'
import { Button } from '@/components/ui/button'


type Project = { id: string; name: string, project_code: string | null }
type SubProject = { id: string; code: string; description: string | null; project_id: string }
type Entry = { sub_project_id: string; work_date: string; hours: number | null }

export default function TimesheetGrid({
  projects,
  subProjects,
  existingEntries,
  weekStart,
  initialSubmissionStatus
}: {
  projects: Project[],
  subProjects: SubProject[],
  existingEntries: Entry[],
  weekStart: Date,
  initialSubmissionStatus: Record<string, boolean>
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)


  // Inicjalizacja danych
  // Inicjalizacja danych
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

  // Efekt do aktualizacji stanu, gdy przyjdą nowe dane z serwera (np. po Copy Week)
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
    // Pozwalamy na pusty ciąg (kasowanie), zamieniamy na 0 przy obliczeniach
    let num = value === '' ? 0 : parseFloat(value)

    // Proste zabezpieczenie przed ujemnymi w UI (choć backend też to sprawdza)
    if (num < 0) num = 0

    setGridData(prev => ({
      ...prev,
      [projectId]: {
        ...prev[projectId],
        [dateStr]: isNaN(num) ? 0 : num
      }
    }))
  }

  const handleSave = async (subprojectId: string, dateStr: string) => {
    const hours = gridData[subprojectId]?.[dateStr] || 0
    setSaving(true)
    await saveWorkEntry(subprojectId, dateStr, hours)
    setSaving(false)
  }



  const dailyTotals = weekDays.map(day => {
    const dateStr = format(day, 'yyyy-MM-dd')
    return subProjects.reduce((acc, sp) => {
      return acc + (gridData[sp.id]?.[dateStr] || 0)
    }, 0)
  })

  const weeklyTotal = dailyTotals.reduce((acc, val) => acc + val, 0)

  const [submittedProjects, setSubmittedProjects] = useState<Record<string, boolean>>(initialSubmissionStatus)



  // Grupuj subprojekty po projekcie
  const projectSubProjects = projects.reduce((acc, project) => {
    acc[project.id] = subProjects.filter(sp => sp.project_id === project.id)
    return acc
  }, {} as Record<string, SubProject[]>)

  return (
    <div className="relative">
      {/* Status zapisywania */}
      <div className="absolute top-[-30px] right-0 h-6 flex items-center justify-end min-w-[100px]">
        {saving ? (
          <span className="text-xs text-blue-600 flex items-center gap-1">
            <Loader2 className="animate-spin h-3 w-3" /> Zapisywanie...
          </span>
        ) : (
          <span className="text-xs text-gray-400">Wszystkie zmiany zapisane</span>
        )}
      </div>

      <div className="overflow-x-auto bg-white rounded-lg shadow border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          {/* --- NAGŁÓWEK --- */}
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500 w-48 min-w-[150px]">Projekt</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 w-20 min-w-[150px]">KOD</th>
              {weekDays.map(day => {
                const isWeekend = day.getDay() === 0 || day.getDay() === 6
                return (
                  <th key={day.toString()} className={`px-2 py-3 text-center font-medium w-24 ${isWeekend ? 'text-red-400' : 'text-gray-500'}`}>
                    <div className="text-xs uppercase">{format(day, 'EEE', { locale: pl })}</div>
                    <div className="text-gray-900">{format(day, 'dd.MM')}</div>
                  </th>
                )
              })}
              <th className="px-4 py-3 text-center font-bold text-gray-700 w-20 bg-gray-100">Σ</th>
              <th className="px-4 py-3 text-center font-medium text-gray-500 min-w-[150px]">Status</th>
            </tr>
          </thead>

          {/* --- BODY --- */}
          <tbody className="divide-y divide-gray-200">
            {projects.map(project => {
              const pSubProjects = projectSubProjects[project.id] || []
              const isExpanded = expandedProjects[project.id]

              // Suma Projektu (ze wszystkich subprojektów)
              const projectDailyTotals = weekDays.map(day => {
                const dateStr = format(day, 'yyyy-MM-dd')
                return pSubProjects.reduce((acc, sp) => {
                  return acc + (gridData[sp.id]?.[dateStr] || 0)
                }, 0)
              })
              const projectWeeklyTotal = projectDailyTotals.reduce((a, b) => a + b, 0)

              return (
                <>
                  {/* --- NAGŁÓWEK PROJEKTU --- */}
                  <tr key={project.id} className="bg-gray-100/50 hover:bg-gray-100 cursor-pointer" onClick={() => toggleProject(project.id)}>
                    <td colSpan={2} className="px-4 py-3 font-semibold text-gray-800 flex items-center gap-2">
                      <span className={`transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                      {project.name}
                    </td>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 w-20 min-w-[150px]">{project.project_code}</th>
                    {projectDailyTotals.map((total, idx) => (
                      <td key={idx} className="px-1 py-3 text-center text-xs font-medium text-gray-500 bg-gray-50/50">
                        {total > 0 ? total : '-'}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-center font-bold text-gray-700 bg-gray-100">
                      {projectWeeklyTotal > 0 ? projectWeeklyTotal : '-'}
                    </td>
                    <td className="px-4 py-3 text-center border-l border-gray-200">
                      -
                    </td>
                  </tr>

                  {/* --- WIERSZE SUBPROJEKTÓW --- */}
                  {isExpanded && pSubProjects.map(subProject => {
                    const rowTotal = weekDays.reduce((acc, day) => {
                      const dateStr = format(day, 'yyyy-MM-dd')
                      return acc + (gridData[subProject.id]?.[dateStr] || 0)
                    }, 0)

                    return (
                      <tr key={subProject.id} className="hover:bg-gray-50 group transition-colors">
                        <td className="px-4 py-2 pl-8 text-sm text-gray-600 truncate max-w-[200px]" title={subProject.description || ''}>
                          {subProject.description || subProject.code || 'Brak opisu'}
                        </td>
                        <td className="px-4 py-2 text-xs font-mono text-gray-500 truncate max-w-[100px]">
                          {subProject.code}
                        </td>
                        {weekDays.map(day => {
                          const dateStr = format(day, 'yyyy-MM-dd')
                          const hours = gridData[subProject.id]?.[dateStr]
                          const isWeekend = day.getDay() === 0 || day.getDay() === 6
                          const bgClass = isWeekend ? 'bg-gray-50' : 'bg-white'

                          return (
                            <td key={dateStr} className={`p-1 border-l border-gray-100 ${bgClass}`}>
                              <input
                                type="number"
                                min="0"
                                max="24"
                                step="0.5"
                                disabled={submittedProjects[subProject.id]}
                                className={`w-full h-8 text-center text-sm rounded border-transparent hover:border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all ${bgClass} ${hours && hours > 12 ? 'text-red-600 font-bold' : ''} disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed`}
                                value={hours === 0 ? '' : hours}
                                placeholder="-"
                                onChange={(e) => handleChange(subProject.id, dateStr, e.target.value)}
                                onBlur={() => handleSave(subProject.id, dateStr)}
                              />
                            </td>
                          )
                        })}
                        <td className="px-4 py-2 text-center font-bold text-blue-600 bg-gray-50 border-l border-gray-200">
                          {rowTotal > 0 ? rowTotal : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-2 text-center border-l border-gray-200">

                          {submittedProjects[subProject.id] ? (
                            <span className="text-green-600">Zatwierdzony</span>
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
                        <td className="border-l border-gray-200"></td>
                      </tr>
                    )
                  })}
                </>
              )
            })}

            {projects.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-12 text-center text-gray-500">
                  <div className="flex flex-col items-center gap-2">
                    <AlertCircle className="h-8 w-8 text-gray-400" />
                    <p>Brak przypisanych projektów.</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>

          {/* --- STOPKA (NOWOŚĆ) --- */}
          <tfoot className="bg-gray-100 font-bold text-gray-900 border-t-2 border-gray-200">
            <tr>
              <td className="px-4 py-3 text-right text-gray-500 text-xs uppercase tracking-wider"></td>
              <td className="px-4 py-3 text-gray-500 text-xs uppercase tracking-wider">Suma :</td>
              {dailyTotals.map((total, index) => {
                // Ostrzeżenie jeśli ktoś pracuje ponad 12h dziennie
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
                <Button
                  onClick={async () => {
                    setSaving(true)
                    await copyWeek(format(weekStart, 'yyyy-MM-dd'))
                    router.refresh() // Added: 4. Call router.refresh()
                    setSaving(false)
                    // Opcjonalnie: reload strony, ale saveWorkEntry robi revalidatePath
                  }}
                  variant="outline"
                  className="bg-blue-50 hover:bg-blue-100 text-blue-600 border-blue-200"
                  disabled={saving}
                >
                  Copy<br /> <span className="text-xs">(last week)</span>
                </Button>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div >
  )
}