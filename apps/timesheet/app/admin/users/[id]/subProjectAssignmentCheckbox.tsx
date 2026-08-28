'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toggleSubProjectAssignment } from '@/app/data/actions/projects'

export default function SubProjectAssignmentCheckbox({
    userId,
    subProjectId,
    projectId,
    initialChecked
}: {
    userId: string
    subProjectId: string
    projectId: string
    initialChecked: boolean
}) {
    const [checked, setChecked] = useState(initialChecked)
    const [loading, setLoading] = useState(false)

    const handleChange = async () => {
        setLoading(true)
        const newState = !checked
        setChecked(newState)

        await toggleSubProjectAssignment(subProjectId, userId, projectId, newState)
        setLoading(false)
    }

    if (loading) {
        return <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
    }

    return (
        <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
            checked={checked}
            onChange={handleChange}
        />
    )
}
