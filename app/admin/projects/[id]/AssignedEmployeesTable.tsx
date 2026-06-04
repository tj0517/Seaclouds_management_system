'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import AssignmentCheckbox from './assignmentCheckbox'

type User = {
    id: string
    full_name: string | null
    role: string | null
}

type Props = {
    users: User[]
    projectId: string
    assignedUserIds: string[]
}

export default function AssignedEmployeesTable({ users, projectId, assignedUserIds }: Props) {
    const [search, setSearch] = useState('')

    const assignedCount = assignedUserIds.length

    const filteredAndSorted = useMemo(() => {
        const filtered = users.filter(user => {
            if (!search) return true
            const name = (user.full_name || '').toLowerCase()
            return name.includes(search.toLowerCase())
        })

        return filtered.sort((a, b) => {
            const aAssigned = assignedUserIds.includes(a.id)
            const bAssigned = assignedUserIds.includes(b.id)
            if (aAssigned && !bAssigned) return -1
            if (!aAssigned && bAssigned) return 1
            return (a.full_name || '').localeCompare(b.full_name || '')
        })
    }, [users, assignedUserIds, search])

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search employees..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                    ({assignedCount} of {users.length} assigned)
                </span>
            </div>

            <div className="max-h-[500px] overflow-y-auto border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Employee</TableHead>
                            <TableHead className="w-[100px]">Role</TableHead>
                            <TableHead className="w-[120px]">Status</TableHead>
                            <TableHead className="w-[80px] text-center">Access</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredAndSorted.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                                    No employees found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredAndSorted.map((user) => {
                                const isAssigned = assignedUserIds.includes(user.id)

                                return (
                                    <TableRow key={user.id}>
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <Avatar className="h-8 w-8">
                                                    <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                                        {user.full_name?.charAt(0) || 'U'}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <span className="font-medium text-sm">{user.full_name || 'User'}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="secondary" className="text-xs">
                                                {user.role || 'employee'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={isAssigned ? "default" : "outline"} className={isAssigned ? "bg-emerald-600" : ""}>
                                                {isAssigned ? 'Assigned' : 'Unassigned'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex justify-center">
                                                <AssignmentCheckbox
                                                    userId={user.id}
                                                    projectId={projectId}
                                                    initialChecked={isAssigned}
                                                />
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )
                            })
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}
