'use client'

import { useState, useEffect } from 'react'
import { submitWeek } from '@/app/data/actions/timesheet'
import { AlertTriangle, Info } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

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

    useEffect(() => {
        setStatus(initialStatus)
    }, [initialStatus])

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
        return (
            <span className="text-green-600 text-xs font-medium inline-flex items-center">
                Submitted
                {rejectReason && <RejectReasonTooltip reason={rejectReason} />}
            </span>
        )
    }

    if (status === 'rejected') {
        return (
            <div className="flex flex-col items-center gap-1">
                <span className="text-red-600 text-xs font-medium inline-flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Rejected
                    {rejectReason && <RejectReasonTooltip reason={rejectReason} />}
                </span>
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
