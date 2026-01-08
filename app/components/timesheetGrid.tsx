'use client'

import { useState } from 'react'
import { format, addDays } from 'date-fns'
import { pl } from 'date-fns/locale'
import { saveWorkEntry } from '@/app/data/actions'
import { Loader2, AlertCircle } from 'lucide-react'

type Project = { id: string; name: string }
type Entry = { project_id: string; work_date: string; hours: number }

export default function TimesheetGrid({ 
  projects, 
  existingEntries,
  weekStart 
}: { 
  projects: Project[], 
  existingEntries: Entry[], 
  weekStart: Date 
}) {
  const [saving, setSaving] = useState(false)

  // Inicjalizacja danych
  const initialData: Record<string, Record<string, number>> = {}
  existingEntries.forEach(entry => {
    if (!initialData[entry.project_id]) initialData[entry.project_id] = {}
    initialData[entry.project_id][entry.work_date] = entry.hours
  })

  const [gridData, setGridData] = useState(initialData)
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

  const handleSave = async (projectId: string, dateStr: string) => {
    const hours = gridData[projectId]?.[dateStr] || 0
    setSaving(true)
    await saveWorkEntry(projectId, dateStr, hours)
    setSaving(false)
  }

  // --- OBLICZENIA SUM (Nowość) ---
  
  // 1. Sumy dla każdego dnia (Kolumny)
  const dailyTotals = weekDays.map(day => {
    const dateStr = format(day, 'yyyy-MM-dd')
    return projects.reduce((acc, project) => {
      return acc + (gridData[project.id]?.[dateStr] || 0)
    }, 0)
  })

  // 2. Suma całkowita tygodnia (Grand Total)
  const weeklyTotal = dailyTotals.reduce((acc, val) => acc + val, 0)

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
              <th className="px-4 py-3 text-left font-medium text-gray-500 w-64 min-w-[150px]">Projekt</th>
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
            </tr>
          </thead>

          {/* --- BODY --- */}
          <tbody className="divide-y divide-gray-200">
            {projects.map(project => {
              // Suma wiersza (Projektu)
              const rowTotal = weekDays.reduce((acc, day) => {
                const dateStr = format(day, 'yyyy-MM-dd')
                return acc + (gridData[project.id]?.[dateStr] || 0)
              }, 0)

              return (
                <tr key={project.id} className="hover:bg-gray-50 group transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900 truncate max-w-[200px]" title={project.name}>
                    {project.name}
                  </td>
                  {weekDays.map(day => {
                    const dateStr = format(day, 'yyyy-MM-dd')
                    const hours = gridData[project.id]?.[dateStr]
                    
                    const isWeekend = day.getDay() === 0 || day.getDay() === 6
                    const bgClass = isWeekend ? 'bg-gray-50' : 'bg-white'

                    return (
                      <td key={dateStr} className={`p-1 border-l border-gray-100 ${bgClass}`}>
                        <input
                          type="number"
                          min="0"
                          max="24"
                          step="0.5"
                          className={`w-full h-9 text-center rounded border-transparent hover:border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all ${bgClass} ${hours && hours > 12 ? 'text-red-600 font-bold' : ''}`}
                          value={hours === 0 ? '' : hours} // Wyświetlaj puste pole zamiast 0 dla czystości
                          placeholder="-"
                          onChange={(e) => handleChange(project.id, dateStr, e.target.value)}
                          onBlur={() => handleSave(project.id, dateStr)}
                        />
                      </td>
                    )
                  })}
                  <td className="px-4 py-3 text-center font-bold text-blue-600 bg-gray-50 border-l border-gray-200">
                    {rowTotal > 0 ? rowTotal : <span className="text-gray-300">-</span>}
                  </td>
                </tr>
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
              <td className="px-4 py-3 text-right text-gray-500 text-xs uppercase tracking-wider">Suma dnia:</td>
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
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}