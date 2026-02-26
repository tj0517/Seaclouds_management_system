'use client'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import Link from 'next/link'
import { UserCog } from 'lucide-react'
import { Database } from '@/utils/supabase/types'

type Profile = Database['public']['Tables']['profiles']['Row']

export default function UsersTable({ users }: { users: Profile[] }) {
    return (
        <div className="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-[80px]">Avatar</TableHead>
                        <TableHead>Pracownik</TableHead>
                        <TableHead>Rola</TableHead>
                        <TableHead className="text-right">Akcje</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {users.map((user) => (
                        <TableRow key={user.id}>
                            <TableCell>
                                <Avatar>
                                    <AvatarImage src="" />
                                    <AvatarFallback className="bg-primary/10 text-primary font-bold">
                                        {user.full_name?.charAt(0) || 'U'}
                                    </AvatarFallback>
                                </Avatar>
                            </TableCell>
                            <TableCell className="font-medium">
                                {user.full_name || 'Brak nazwy'}
                            </TableCell>
                            <TableCell>
                                <Badge variant={user.role === 'admin' ? "default" : "secondary"}>
                                    {user.role}
                                </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                                <Button variant="outline" size="sm" asChild>
                                    <Link href={`/admin/users/${user.id}`}>
                                        <UserCog className="mr-2 h-4 w-4" /> Zarządzaj
                                    </Link>
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}
                    {users.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                                No users found.
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    )
}
