'use client'

import { useMemo, useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import Link from 'next/link'
import { ArrowDown, ArrowUp, ArrowUpDown, UserCog, X } from 'lucide-react'
import { Database } from '@/utils/supabase/types'
import { getInitials } from '@/lib/utils'

type Profile = Database['public']['Tables']['profiles']['Row']

type SortField = 'full_name' | 'role'
type SortDir = 'asc' | 'desc'

const ROLE_LABEL: Record<string, string> = {
    admin: 'Admin',
    project_lead: 'Lead',
    employee: 'Employee',
}

export default function UsersTable({ users }: { users: Profile[] }) {
    const [search, setSearch] = useState('')
    const [roleFilter, setRoleFilter] = useState('')
    const [sortField, setSortField] = useState<SortField>('full_name')
    const [sortDir, setSortDir] = useState<SortDir>('asc')

    function toggleSort(field: SortField) {
        if (sortField === field) {
            setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
        } else {
            setSortField(field)
            setSortDir('asc')
        }
    }

    function SortIcon({ field }: { field: SortField }) {
        if (sortField !== field) return <ArrowUpDown className="ml-1.5 h-3.5 w-3.5 text-muted-foreground/50" />
        return sortDir === 'asc'
            ? <ArrowUp className="ml-1.5 h-3.5 w-3.5" />
            : <ArrowDown className="ml-1.5 h-3.5 w-3.5" />
    }

    const filteredUsers = useMemo(() => {
        const q = search.trim().toLowerCase()
        const result = users.filter(user => {
            if (roleFilter && user.role !== roleFilter) return false
            if (q && !(user.full_name || 'No name').toLowerCase().includes(q)) return false
            return true
        })

        result.sort((a, b) => {
            let cmp = 0
            if (sortField === 'full_name') {
                cmp = (a.full_name || '').localeCompare(b.full_name || '')
            } else {
                cmp = (a.role || '').localeCompare(b.role || '')
            }
            return sortDir === 'asc' ? cmp : -cmp
        })

        return result
    }, [users, search, roleFilter, sortField, sortDir])

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by name..."
                    className="h-9 max-w-xs"
                />

                <select
                    value={roleFilter}
                    onChange={e => setRoleFilter(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                    <option value="">All roles</option>
                    <option value="admin">Admin</option>
                    <option value="project_lead">Lead</option>
                    <option value="employee">Employee</option>
                </select>

                {(search || roleFilter) && (
                    <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setRoleFilter('') }}>
                        <X className="h-3 w-3" /> Clear filters
                    </Button>
                )}
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[80px]">Avatar</TableHead>
                            <TableHead>
                                <button className="flex items-center hover:text-foreground" onClick={() => toggleSort('full_name')}>
                                    Employee <SortIcon field="full_name" />
                                </button>
                            </TableHead>
                            <TableHead>ID</TableHead>
                            <TableHead>
                                <button className="flex items-center hover:text-foreground" onClick={() => toggleSort('role')}>
                                    Role <SortIcon field="role" />
                                </button>
                            </TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredUsers.map((user) => (
                            <TableRow key={user.id}>
                                <TableCell>
                                    <Avatar>
                                        <AvatarImage src="" />
                                        <AvatarFallback className="bg-primary/10 text-primary font-bold">
                                            {getInitials(user.full_name)}
                                        </AvatarFallback>
                                    </Avatar>
                                </TableCell>
                                <TableCell className="font-medium">
                                    {user.full_name || 'No name'}
                                </TableCell>
                                <TableCell className="text-muted-foreground text-sm font-mono">
                                    {user.employee_id || '—'}
                                </TableCell>
                                <TableCell>
                                    <Badge variant={user.role === 'admin' ? "default" : (user.role as string) === 'project_lead' ? "outline" : "secondary"}>
                                        {ROLE_LABEL[user.role as string] || user.role}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                    <Button variant="outline" size="sm" asChild>
                                        <Link href={`/admin/users/${user.id}`}>
                                            <UserCog className="mr-2 h-4 w-4" /> Manage
                                        </Link>
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                        {filteredUsers.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                    No users found.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}
