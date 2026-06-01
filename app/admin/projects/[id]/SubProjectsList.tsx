'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { createSubProject, toggleSubProjectStatus, toggleSubProjectAssignment } from '@/app/data/actions/projects'
import { Plus, CheckCircle2, Ban, Users, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

type SubProject = {
    id: string
    code: string
    description: string | null
    is_active: boolean | null
    project_id: string
}

type User = {
    id: string
    full_name: string | null
    role: string | null
}

type Props = {
    projectId: string
    initialSubProjects: SubProject[]
    assignedUsers: User[]
    subProjectAssignments: Record<string, string[]>
}

export default function SubProjectsList({ projectId, initialSubProjects, assignedUsers, subProjectAssignments }: Props) {
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [togglingAssignment, setTogglingAssignment] = useState<string | null>(null)
    const [togglingStatus, setTogglingStatus] = useState<string | null>(null)
    const router = useRouter()

    const [code, setCode] = useState('')
    const [description, setDescription] = useState('')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)

        const formData = new FormData()
        formData.append('project_id', projectId)
        formData.append('code', code)
        formData.append('description', description)

        const result = await createSubProject(formData)

        setLoading(false)
        if (result.success) {
            toast.success('Sub-project added successfully')
            setOpen(false)
            setCode('')
            setDescription('')
            router.refresh()
        } else {
            toast.error(result.error || 'Error adding sub-project')
        }
    }

    const handleToggleStatus = async (id: string, currentStatus: boolean) => {
        setTogglingStatus(id)
        const result = await toggleSubProjectStatus(id, projectId, !currentStatus)
        setTogglingStatus(null)
        if (result.success) {
            toast.success(currentStatus ? 'Sub-project deactivated' : 'Sub-project activated')
            router.refresh()
        } else {
            toast.error(result.error || 'Error changing status')
        }
    }

    const handleToggleAssignment = async (subProjectId: string, userId: string, isCurrentlyAssigned: boolean) => {
        const key = `${subProjectId}-${userId}`
        setTogglingAssignment(key)
        const result = await toggleSubProjectAssignment(subProjectId, userId, projectId, !isCurrentlyAssigned)
        setTogglingAssignment(null)
        if (result.success) {
            toast.success(isCurrentlyAssigned ? 'User removed from sub-project' : 'User assigned to sub-project')
            router.refresh()
        } else {
            toast.error('Error updating assignment')
        }
    }

    const getAssignedUserNames = (subProjectId: string) => {
        const userIds = subProjectAssignments[subProjectId] || []
        return assignedUsers.filter(u => userIds.includes(u.id))
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div>
                    <CardTitle>Sub-projects</CardTitle>
                    <CardDescription>Manage task codes and user assignments for this project.</CardDescription>
                </div>
                <Dialog open={open} onOpenChange={setOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm" className="gap-1">
                            <Plus size={16} /> Add Sub-project
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Add New Sub-project</DialogTitle>
                            <DialogDescription>
                                Sub-projects allow for more detailed time reporting.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="code">Code / Name (Required)</Label>
                                <Input
                                    id="code"
                                    value={code}
                                    onChange={(e) => setCode(e.target.value)}
                                    placeholder="e.g. ANALYSIS, DEV-001"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="description">Description (Optional)</Label>
                                <Input
                                    id="description"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="e.g. Business requirements analysis"
                                />
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                                <Button type="submit" disabled={loading}>{loading ? 'Adding...' : 'Add'}</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardHeader>
            <CardContent>
                {initialSubProjects.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm">
                        No sub-projects defined.
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[150px]">Code</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead>Assigned Users</TableHead>
                                <TableHead className="w-[100px]">Status</TableHead>
                                <TableHead className="w-[100px] text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {initialSubProjects.map((sp) => {
                                const spAssignedUsers = getAssignedUserNames(sp.id)

                                return (
                                    <TableRow key={sp.id} className={sp.is_active ? '' : 'bg-muted/50'}>
                                        <TableCell className="font-medium">{sp.code}</TableCell>
                                        <TableCell className="text-muted-foreground">{sp.description || '-'}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                {spAssignedUsers.length > 0 ? (
                                                    <div className="flex -space-x-2">
                                                        {spAssignedUsers.slice(0, 3).map(u => (
                                                            <Avatar key={u.id} className="h-7 w-7 border-2 border-background">
                                                                <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                                                                    {u.full_name?.charAt(0) || 'U'}
                                                                </AvatarFallback>
                                                            </Avatar>
                                                        ))}
                                                        {spAssignedUsers.length > 3 && (
                                                            <span className="ml-2 text-xs text-muted-foreground">
                                                                +{spAssignedUsers.length - 3}
                                                            </span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">No users</span>
                                                )}
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7">
                                                            <Users className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-64 p-0" align="start">
                                                        <div className="p-3 border-b">
                                                            <p className="text-sm font-medium">Assign Users</p>
                                                            <p className="text-xs text-muted-foreground">
                                                                Select employees for {sp.code}
                                                            </p>
                                                        </div>
                                                        <div className="max-h-48 overflow-y-auto p-2 space-y-1">
                                                            {assignedUsers.length === 0 ? (
                                                                <p className="text-xs text-muted-foreground p-2 text-center">
                                                                    No employees assigned to this project yet.
                                                                </p>
                                                            ) : (
                                                                assignedUsers.map(user => {
                                                                    const isAssigned = (subProjectAssignments[sp.id] || []).includes(user.id)
                                                                    const isToggling = togglingAssignment === `${sp.id}-${user.id}`

                                                                    return (
                                                                        <label
                                                                            key={user.id}
                                                                            className="flex items-center gap-2 p-2 rounded-md hover:bg-accent cursor-pointer"
                                                                        >
                                                                            <Checkbox
                                                                                checked={isAssigned}
                                                                                disabled={isToggling}
                                                                                onCheckedChange={() => handleToggleAssignment(sp.id, user.id, isAssigned)}
                                                                            />
                                                                            <Avatar className="h-6 w-6">
                                                                                <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                                                                                    {user.full_name?.charAt(0) || 'U'}
                                                                                </AvatarFallback>
                                                                            </Avatar>
                                                                            <span className="text-sm truncate">
                                                                                {user.full_name || 'User'}
                                                                            </span>
                                                                        </label>
                                                                    )
                                                                })
                                                            )}
                                                        </div>
                                                    </PopoverContent>
                                                </Popover>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={sp.is_active ? "outline" : "secondary"} className={sp.is_active ? "text-green-600 border-green-200" : ""}>
                                                {sp.is_active ? 'Active' : 'Inactive'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                title={sp.is_active ? "Deactivate" : "Activate"}
                                                disabled={togglingStatus === sp.id}
                                                onClick={() => handleToggleStatus(sp.id, sp.is_active || false)}
                                            >
                                                {togglingStatus === sp.id
                                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                                    : sp.is_active ? <Ban className="h-4 w-4 text-orange-500" /> : <CheckCircle2 className="h-4 w-4 text-green-600" />
                                                }
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    )
}
