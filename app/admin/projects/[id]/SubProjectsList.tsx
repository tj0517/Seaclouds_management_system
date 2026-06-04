'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createSubProject, updateSubProject, toggleSubProjectStatus, toggleSubProjectAssignment, deleteSubProject } from '@/app/data/actions/projects'
import { Plus, Users, Loader2, Pencil, Trash2, Search } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

type SubProject = {
    id: string
    code: string
    description: string | null
    is_active: boolean | null
    project_id: string
    tracking_type?: string
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
    const [trackingType, setTrackingType] = useState('hours')

    const [editOpen, setEditOpen] = useState(false)
    const [editLoading, setEditLoading] = useState(false)
    const [editingSp, setEditingSp] = useState<SubProject | null>(null)
    const [editCode, setEditCode] = useState('')
    const [editDescription, setEditDescription] = useState('')
    const [editTrackingType, setEditTrackingType] = useState('hours')

    const [deleteOpen, setDeleteOpen] = useState(false)
    const [deletingSp, setDeletingSp] = useState<SubProject | null>(null)
    const [deleteLoading, setDeleteLoading] = useState(false)

    const [assignOpen, setAssignOpen] = useState(false)
    const [assigningSp, setAssigningSp] = useState<SubProject | null>(null)
    const [assignSearch, setAssignSearch] = useState('')

    const openEdit = (sp: SubProject) => {
        setEditingSp(sp)
        setEditCode(sp.code)
        setEditDescription(sp.description || '')
        setEditTrackingType(sp.tracking_type || 'hours')
        setEditOpen(true)
    }

    const handleEditSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingSp) return
        setEditLoading(true)

        const formData = new FormData()
        formData.append('code', editCode)
        formData.append('description', editDescription)
        formData.append('tracking_type', editTrackingType)

        const result = await updateSubProject(editingSp.id, projectId, formData)
        setEditLoading(false)
        if (result.success) {
            toast.success('Sub-project updated')
            setEditOpen(false)
            setEditingSp(null)
            router.refresh()
        } else {
            toast.error(result.error || 'Error updating sub-project')
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)

        const formData = new FormData()
        formData.append('project_id', projectId)
        formData.append('code', code)
        formData.append('description', description)
        formData.append('tracking_type', trackingType)

        const result = await createSubProject(formData)

        setLoading(false)
        if (result.success) {
            toast.success('Sub-project added successfully')
            setOpen(false)
            setCode('')
            setDescription('')
            setTrackingType('hours')
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

    const openDeleteConfirm = (sp: SubProject) => {
        setDeletingSp(sp)
        setDeleteOpen(true)
    }

    const handleDelete = async () => {
        if (!deletingSp) return
        setDeleteLoading(true)
        const result = await deleteSubProject(deletingSp.id, projectId)
        setDeleteLoading(false)
        if (result.success) {
            toast.success(result.softDeleted ? 'Sub-project deactivated (has time entries)' : 'Sub-project deleted')
            setDeleteOpen(false)
            setDeletingSp(null)
            router.refresh()
        } else {
            toast.error(result.error || 'Error deleting sub-project')
        }
    }

    const getAssignedUserNames = (subProjectId: string) => {
        const userIds = subProjectAssignments[subProjectId] || []
        return assignedUsers.filter(u => userIds.includes(u.id))
    }

    const openAssignDialog = (sp: SubProject) => {
        setAssigningSp(sp)
        setAssignSearch('')
        setAssignOpen(true)
    }

    const filteredAssignUsers = useMemo(() => {
        if (!assigningSp) return []
        const filtered = assignedUsers.filter(u => {
            if (!assignSearch) return true
            return (u.full_name || '').toLowerCase().includes(assignSearch.toLowerCase())
        })
        const spAssigned = subProjectAssignments[assigningSp.id] || []
        return filtered.sort((a, b) => {
            const aAssigned = spAssigned.includes(a.id)
            const bAssigned = spAssigned.includes(b.id)
            if (aAssigned && !bAssigned) return -1
            if (!aAssigned && bAssigned) return 1
            return (a.full_name || '').localeCompare(b.full_name || '')
        })
    }, [assignedUsers, assigningSp, assignSearch, subProjectAssignments])

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
                            <div className="space-y-2">
                                <Label>Tracking Type</Label>
                                <Select value={trackingType} onValueChange={setTrackingType}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="hours">Hours</SelectItem>
                                        <SelectItem value="days">Days</SelectItem>
                                    </SelectContent>
                                </Select>
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
                                <TableHead className="w-[80px]">Type</TableHead>
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
                                            <Badge variant="outline" className={(sp.tracking_type ?? 'hours') === 'days' ? 'text-purple-600 border-purple-200' : 'text-blue-600 border-blue-200'}>
                                                {(sp.tracking_type ?? 'hours') === 'days' ? 'Days' : 'Hours'}
                                            </Badge>
                                        </TableCell>
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
                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openAssignDialog(sp)}>
                                                    <Users className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={sp.is_active ? "outline" : "secondary"} className={sp.is_active ? "text-green-600 border-green-200" : ""}>
                                                {sp.is_active ? 'Active' : 'Inactive'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    title="Edit sub-project"
                                                    onClick={() => openEdit(sp)}
                                                >
                                                    <Pencil className="h-4 w-4 text-blue-500" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    title="Delete sub-project"
                                                    onClick={() => openDeleteConfirm(sp)}
                                                >
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                                {togglingStatus === sp.id ? (
                                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                                ) : (
                                                    <Switch
                                                        checked={sp.is_active || false}
                                                        onCheckedChange={() => handleToggleStatus(sp.id, sp.is_active || false)}
                                                        aria-label={sp.is_active ? "Deactivate" : "Activate"}
                                                    />
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                )}
            </CardContent>

            <Dialog open={editOpen} onOpenChange={(v) => { setEditOpen(v); if (!v) setEditingSp(null) }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Sub-project</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleEditSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="edit-code">Code / Name</Label>
                            <Input
                                id="edit-code"
                                value={editCode}
                                onChange={(e) => setEditCode(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-description">Description</Label>
                            <Input
                                id="edit-description"
                                value={editDescription}
                                onChange={(e) => setEditDescription(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Tracking Type</Label>
                            <Select value={editTrackingType} onValueChange={setEditTrackingType}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="hours">Hours</SelectItem>
                                    <SelectItem value="days">Days</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                            <Button type="submit" disabled={editLoading}>{editLoading ? 'Saving...' : 'Save'}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={deleteOpen} onOpenChange={(v) => { setDeleteOpen(v); if (!v) setDeletingSp(null) }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Sub-project</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete <span className="font-semibold">{deletingSp?.code}</span>?
                            If time entries exist, the sub-project will be deactivated instead of permanently deleted.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
                        <Button variant="destructive" disabled={deleteLoading} onClick={handleDelete}>
                            {deleteLoading ? 'Deleting...' : 'Delete'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={assignOpen} onOpenChange={(v) => { if (togglingAssignment) return; setAssignOpen(v); if (!v) { setAssigningSp(null); setAssignSearch('') } }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Assign Users</DialogTitle>
                        <DialogDescription>
                            Select employees for <span className="font-semibold">{assigningSp?.code}</span>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search employees..."
                            value={assignSearch}
                            onChange={(e) => setAssignSearch(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                    <div className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-1">
                        {assignedUsers.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-6 text-center">
                                No employees assigned to this project yet.
                            </p>
                        ) : filteredAssignUsers.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-6 text-center">
                                No employees match your search.
                            </p>
                        ) : (
                            filteredAssignUsers.map(user => {
                                const isAssigned = assigningSp ? (subProjectAssignments[assigningSp.id] || []).includes(user.id) : false
                                const isToggling = assigningSp ? togglingAssignment === `${assigningSp.id}-${user.id}` : false

                                return (
                                    <label
                                        key={user.id}
                                        className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent cursor-pointer transition-colors"
                                    >
                                        <Checkbox
                                            checked={isAssigned}
                                            disabled={!!togglingAssignment}
                                            onCheckedChange={() => assigningSp && handleToggleAssignment(assigningSp.id, user.id, isAssigned)}
                                        />
                                        <Avatar className="h-8 w-8">
                                            <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                                {user.full_name?.charAt(0) || 'U'}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="flex-1 min-w-0">
                                            <span className="text-sm font-medium truncate block">
                                                {user.full_name || 'User'}
                                            </span>
                                        </div>
                                        {isToggling && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                                    </label>
                                )
                            })
                        )}
                    </div>
                    <DialogFooter>
                        <div className="flex items-center justify-between w-full">
                            <span className="text-xs text-muted-foreground">
                                {assigningSp ? (subProjectAssignments[assigningSp.id] || []).length : 0} assigned
                            </span>
                            <Button variant="outline" disabled={!!togglingAssignment} onClick={() => setAssignOpen(false)}>Done</Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    )
}
