'use client'

import { useState } from 'react'
import { submitWeek } from '@/app/data/actions/timesheet'
import { AlertTriangle } from 'lucide-react'

type Props = {
    weekStart: string
    subprojectId: string
    status: string | null // null = no submission, 'submitted', 'rejected'
    rejectReason: string | null
    onSuccess?: () => void
}

export default function SubmitWeekButton({ weekStart, subprojectId, status: initialStatus, rejectReason, onSuccess }: Props) {
    const [status, setStatus] = useState(initialStatus)
    const [loading, setLoading] = useState(false)
    const [showReason, setShowReason] = useState(false)

    const submitWeekHandler = async () => {
        setLoading(true)
        const result = await submitWeek(weekStart, subprojectId)
        setLoading(false)
        if (result.success) {
            setStatus('submitted')
            if (onSuccess) onSuccess()
        }
    }

    if (status === 'submitted') {
        return <span className="text-green-600 text-xs font-medium">Submitted</span>
    }

    if (status === 'rejected') {
        return (
            <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-1">
                    <span className="text-red-600 text-xs font-medium flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Rejected
                    </span>
                    {rejectReason && (
                        <button
                            onClick={() => setShowReason(v => !v)}
                            className="text-xs text-gray-500 underline hover:text-gray-700"
                        >
                            {showReason ? 'hide' : 'why?'}
                        </button>
                    )}
                </div>
                {showReason && rejectReason && (
                    <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 max-w-[200px] text-left">
                        {rejectReason}
                    </div>
                )}
                <button
                    onClick={submitWeekHandler}
                    disabled={loading}
                    className="px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {loading ? '...' : 'Resubmit'}
                </button>
            </div>
        )
    }

    // No submission yet
    return (
        <button
            onClick={submitWeekHandler}
            disabled={loading}
            className="px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
            {loading ? '...' : 'Submit'}
        </button>
    )
}
