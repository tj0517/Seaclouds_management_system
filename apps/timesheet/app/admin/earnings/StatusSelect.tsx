'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { setEarningStatus, type EarningStatus } from '@/app/data/actions/earnings'

const STATUSES: { value: EarningStatus; label: string; dot: string }[] = [
    { value: 'pending',   label: 'Pending',   dot: 'bg-gray-400' },
    { value: 'submitted', label: 'Submitted', dot: 'bg-yellow-500' },
    { value: 'paid',      label: 'Paid',      dot: 'bg-green-500' },
    { value: 'declined',  label: 'Declined',  dot: 'bg-red-500' },
]

const TRIGGER_CLASSES: Record<EarningStatus, string> = {
    pending:   'bg-gray-100 text-gray-700 border-gray-200',
    submitted: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    paid:      'bg-green-50 text-green-800 border-green-200',
    declined:  'bg-red-50 text-red-800 border-red-200',
}

interface Props {
    userId: string
    yearMonth: string
    status: EarningStatus
}

export default function StatusSelect({ userId, yearMonth, status }: Props) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()

    function handleChange(next: EarningStatus) {
        startTransition(async () => {
            const res = await setEarningStatus(userId, yearMonth, next)
            if (res.error) toast.error(res.error)
            else router.refresh()
        })
    }

    return (
        <Select value={status} onValueChange={handleChange} disabled={pending}>
            <SelectTrigger
                className={`h-7 w-[120px] text-xs font-medium rounded-full border ${TRIGGER_CLASSES[status]} ${pending ? 'opacity-50' : ''}`}
            >
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {STATUSES.map(s => (
                    <SelectItem key={s.value} value={s.value}>
                        <span className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                            {s.label}
                        </span>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
