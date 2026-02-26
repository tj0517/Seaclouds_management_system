'use client'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Database } from '@/utils/supabase/types'
import { UserCog } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

type Project = Database['public']['Tables']['projects']['Row']

export default function ProjectsTable({ projects }: { projects: Project[] }) {
    return (
        <div className="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Nazwa</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">KOD / ID</TableHead>
                        <TableHead className="text-right">Akcje</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {projects?.map((project) => (
                        <TableRow key={project.id}>
                            <TableCell className="font-medium">{project.name.slice(0, 10) + (project.name.length > 10 ? '...' : '')}</TableCell>
                            <TableCell>
                                <Badge variant={project.is_active ? "default" : "destructive"} className={project.is_active ? "bg-emerald-600 hover:bg-emerald-700" : ""}>
                                    {project.is_active ? 'Aktywny' : 'Zakończony'}
                                </Badge>
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground font-mono">
                                {project.project_code || project.id.slice(0, 8)}
                            </TableCell>
                            <TableCell className="text-right">
                                <Button variant="outline" size="sm" asChild>
                                    <Link href={`/admin/projects/${project.id}`}>
                                        <UserCog className="mr-2 h-4 w-4" /> Zarządzaj
                                    </Link>
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}

                    {projects?.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                                Brak projektów.
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    )
}
