'use client'

import { useState } from 'react'
import { submitWeek } from '@/app/data/actions/timesheet'

type Props = {
    weekStart: string
    subprojectId: string
    isSubmitted: boolean
    onSuccess?: () => void
}

export default function SubmitWeekButton({ weekStart, subprojectId, isSubmitted: initialIsSubmitted, onSuccess }: Props) {
    const [isSubmitted, setIsSubmitted] = useState(initialIsSubmitted)
    const [loading, setLoading] = useState(false)

    const submitWeekHandler = async () => {
        setLoading(true)
        const result = await submitWeek(weekStart, subprojectId)
        setLoading(false)
        if (result.success) {
            setIsSubmitted(true)
            if (onSuccess) onSuccess()
        }
    }

    return (
        <button
            onClick={submitWeekHandler}
            disabled={isSubmitted || loading}
            className="px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
            {isSubmitted ? 'Zatwierdzony' : loading ? '...' : 'Zatwierdź'}
        </button>
    )
}
