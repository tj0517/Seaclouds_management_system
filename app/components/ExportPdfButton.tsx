'use client'

import { useState } from 'react'
import { generateMonthlyPdf } from '@/app/data/actions/pdf'
import { Button } from '@/components/ui/button'
import { FileDown, Loader2 } from 'lucide-react'
import { format } from 'date-fns'

export default function ExportPdfButton() {
    const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function handleExport() {
        setLoading(true)
        setError(null)
        try {
            const result = await generateMonthlyPdf(month)
            if (result.error) {
                setError(result.error)
            } else if (result.url) {
                window.open(result.url, '_blank')
            }
        } catch (e: any) {
            setError(e.message || 'Export failed')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex items-center gap-2">
            <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
            />
            <Button
                onClick={handleExport}
                disabled={loading}
                variant="outline"
                size="sm"
                className="gap-1.5"
            >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                <span className="hidden sm:inline">Export PDF</span>
            </Button>
            {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
    )
}
