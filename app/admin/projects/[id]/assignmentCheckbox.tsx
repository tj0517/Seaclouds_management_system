'use client'

import { Checkbox } from "@/components/ui/checkbox"
import { toggleProjectAssignment } from '@/app/data/actions'
import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

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

    const handleChange = async (val: boolean) => {
        // Optimistic update
        setChecked(val)
        setLoading(true)

        try {
            await toggleProjectAssignment(userId, projectId, val)
            toast.success(val ? "Przypisano pracownika" : "Odebrano dostęp")
        } catch (error) {
            // Revert on error
            setChecked(!val)
            toast.error("Wystąpił błąd podczas zmiany uprawnień")
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    }

    return (
        <Checkbox
            checked={checked}
            onCheckedChange={handleChange}
        />
    )
}
