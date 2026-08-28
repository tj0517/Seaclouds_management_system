'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toggleProjectAssignment } from '@/app/data/actions'

export default function AssignmentCheckbox({
  userId,
  projectId,
  initialChecked
}: {
  userId: string,
  projectId: string,
  initialChecked: boolean
}) {
  const [checked, setChecked] = useState(initialChecked)
  const [loading, setLoading] = useState(false)

  const handleChange = async () => {
    setLoading(true)
    const newState = !checked
    setChecked(newState)

    await toggleProjectAssignment(userId, projectId, newState)
    setLoading(false)
  }

  if (loading) {
    return <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
  }

  return (
    <input
      type="checkbox"
      className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
      checked={checked}
      onChange={handleChange}
    />
  )
}
