'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { setEarningStatus, type EarningStatus } from '@/app/data/actions/earnings'

const STATUSES: { value: EarningStatus; label: string; classes: string }[] = [
    { value: 'pending',   label: 'Pending',   classes: 'bg-gray-100 text-gray-600' },
    { value: 'submitted', label: 'Submitted', classes: 'bg-yellow-100 text-yellow-700' },
    { value: 'paid',      label: 'Paid',      classes: 'bg-green-100 text-green-700' },
    { value: 'declined',  label: 'Declined',  classes: 'bg-red-100 text-red-700' },
]

interface Props {
    userId: string
    yearMonth: string
    status: EarningStatus
}

export default function StatusSelect({ userId, yearMonth, status }: Props) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()

    const current = STATUSES.find(s => s.value === status) ?? STATUSES[0]

    function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
        const next = e.target.value as EarningStatus
        startTransition(async () => {
            const res = await setEarningStatus(userId, yearMonth, next)
            if (res.error) toast.error(res.error)
            else router.refresh()
        })
    }

    return (
        <select
            value={status}
            onChange={handleChange}
            disabled={pending}
            className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 ${current.classes}`}
        >
            {STATUSES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
            ))}
        </select>
    )
}
