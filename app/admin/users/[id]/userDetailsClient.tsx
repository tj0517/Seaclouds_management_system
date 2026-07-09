'use client'

import { toast } from "sonner"

import AssignmentCheckbox from './assignmentCheckbox'
import SubProjectAssignmentCheckbox from './subProjectAssignmentCheckbox'
import Link from 'next/link'
import { ArrowLeft, ShieldOff, ChevronDown, ChevronRight, Pencil, Mail } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Database } from '@/utils/supabase/types'
import { deactivateUser, updateUserProfile, changeUserEmail } from '@/app/data/actions'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'

type Profile = Database['public']['Tables']['profiles']['Row']
type Project = Database['public']['Tables']['projects']['Row']

type SubProject = {
    id: string
    code: string
    description: string | null
    is_active: boolean | null
    project_id: string
}

interface UserDetailsClientProps {
    currentUser: Profile | undefined
    userId: string
    projects: Project[]
    assignedProjectIds: string[]
    subProjectsByProject: Record<string, SubProject[]>
    userSubProjectIds: string[]
    userEmail: string | null
}

export default function UserDetailsClient({
    currentUser,
    userId,
    projects,
    assignedProjectIds,
    subProjectsByProject,
    userSubProjectIds,
    userEmail
}: UserDetailsClientProps) {
    const [isPending, startTransition] = useTransition()
    const [deactivateOpen, setDeactivateOpen] = useState(false)
    const [emailChangeOpen, setEmailChangeOpen] = useState(false)
    const [editingEmail, setEditingEmail] = useState(false)
    const [newEmail, setNewEmail] = useState(userEmail || '')
    const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})
    const router = useRouter()

    const [fullName, setFullName] = useState(currentUser?.full_name || '')
    const [employeeId, setEmployeeId] = useState(currentUser?.employee_id || '')
    const [position, setPosition] = useState(currentUser?.position || '')
    const [role, setRole] = useState<'admin' | 'employee' | 'project_lead'>(currentUser?.role || 'employee')
    const [rateHourly, setRateHourly] = useState(currentUser?.rate_hourly?.toString() || '')
    const [rateDaily, setRateDaily] = useState(currentUser?.rate_daily?.toString() || '')

    const toggleExpanded = (projectId: string) => {
        setExpandedProjects(prev => ({ ...prev, [projectId]: !prev[projectId] }))
    }

    const handleDeactivate = () => {
        startTransition(async () => {
            const result = await deactivateUser(userId)
            if (result.error) {
                toast.error(`Error: ${result.error}`)
                setDeactivateOpen(false)
            } else {
                toast.success('All project access has been revoked')
                setDeactivateOpen(false)
                router.push('/admin/users')
                router.refresh()
            }
        })
    }

    const handleSaveProfile = () => {
        startTransition(async () => {
            const result = await updateUserProfile(userId, {
                full_name: fullName || null,
                employee_id: employeeId || null,
                position: position || null,
                role,
                rate_hourly: rateHourly ? Number(rateHourly) : null,
                rate_daily: rateDaily ? Number(rateDaily) : null,
            })
            if (result.error) {
                toast.error(`Error: ${result.error}`)
            } else {
                toast.success('Profile updated successfully')
                router.refresh()
            }
        })
    }

    const handleEmailChange = () => {
        if (!newEmail || newEmail === userEmail) return
        setEmailChangeOpen(true)
    }

    const confirmEmailChange = () => {
        startTransition(async () => {
            const result = await changeUserEmail(userId, newEmail)
            if (result.error) {
                toast.error(`Error: ${result.error}`)
            } else {
                toast.success('Email changed successfully')
                setEditingEmail(false)
                router.refresh()
            }
            setEmailChangeOpen(false)
        })
    }

    return (
        <>
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" asChild>
                    <Link href="/admin/users">
                        <ArrowLeft className="mr-2 h-4 w-4" /> Back
                    </Link>
                </Button>
                <h2 className="text-3xl font-bold tracking-tight">Edit Permissions</h2>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
                {/* User Profile Card */}
                <div className="md:col-span-1">
                    <Card>
                        <CardHeader className="flex flex-row items-center gap-4">
                            <Avatar className="h-12 w-12">
                                <AvatarImage src="" />
                                <AvatarFallback className="text-lg bg-primary/10 text-primary">
                                    {currentUser?.full_name?.charAt(0) || 'U'}
                                </AvatarFallback>
                            </Avatar>
                            <div>
                                <CardTitle className="text-lg">{currentUser?.full_name || 'User'}</CardTitle>
                                <CardDescription className="text-xs font-mono">{userId}</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Email</Label>
                                {editingEmail ? (
                                    <div className="flex gap-2">
                                        <Input
                                            type="email"
                                            value={newEmail}
                                            onChange={(e) => setNewEmail(e.target.value)}
                                            placeholder="user@example.com"
                                        />
                                        <Button size="sm" onClick={handleEmailChange} disabled={isPending || !newEmail || newEmail === userEmail}>
                                            Save
                                        </Button>
                                        <Button size="sm" variant="ghost" onClick={() => { setEditingEmail(false); setNewEmail(userEmail || '') }} disabled={isPending}>
                                            Cancel
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-sm text-muted-foreground flex items-center gap-2">
                                            <Mail className="h-3.5 w-3.5" />
                                            {userEmail || 'No email'}
                                        </span>
                                        <Button size="sm" variant="ghost" onClick={() => setEditingEmail(true)}>
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="full-name">Full Name</Label>
                                <Input
                                    id="full-name"
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="employee-id">Employee ID</Label>
                                <Input
                                    id="employee-id"
                                    value={employeeId}
                                    onChange={(e) => setEmployeeId(e.target.value)}
                                    placeholder="e.g. EMP-001"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="position">Position</Label>
                                <Input
                                    id="position"
                                    value={position}
                                    onChange={(e) => setPosition(e.target.value)}
                                    placeholder="e.g. Software Engineer"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="role">Role</Label>
                                <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'employee' | 'project_lead')}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="employee">Employee</SelectItem>
                                        <SelectItem value="project_lead">Project Lead</SelectItem>
                                        <SelectItem value="admin">Admin</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="rate-hourly">Hourly Rate</Label>
                                    <Input
                                        id="rate-hourly"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={rateHourly}
                                        onChange={(e) => setRateHourly(e.target.value)}
                                        placeholder="0.00"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="rate-daily">Daily Rate</Label>
                                    <Input
                                        id="rate-daily"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={rateDaily}
                                        onChange={(e) => setRateDaily(e.target.value)}
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>
                            <Button className="w-full" onClick={handleSaveProfile} disabled={isPending}>
                                {isPending ? 'Saving...' : 'Save Changes'}
                            </Button>

                            <div className="pt-4 border-t">
                                <Button variant="outline" size="sm" className="w-full border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800" onClick={() => setDeactivateOpen(true)}>
                                    <ShieldOff className="mr-2 h-4 w-4" /> Revoke All Access
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Project & Sub-project Access */}
                <div className="md:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Project Access</CardTitle>
                            <CardDescription>
                                Select projects and sub-projects where this employee can log working hours.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                {projects?.map((project) => {
                                    const isAssigned = assignedProjectIds.includes(project.id)
                                    const subProjects = subProjectsByProject[project.id] || []
                                    const isExpanded = expandedProjects[project.id]
                                    const activeSubProjects = subProjects.filter(sp => sp.is_active)

                                    return (
                                        <div key={project.id} className="border rounded-lg overflow-hidden">
                                            <div className="flex items-center justify-between p-4 hover:bg-accent/5 transition-colors">
                                                <div className="flex items-center gap-3 flex-1">
                                                    {isAssigned && activeSubProjects.length > 0 ? (
                                                        <button
                                                            onClick={() => toggleExpanded(project.id)}
                                                            className="text-muted-foreground hover:text-foreground"
                                                        >
                                                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                                        </button>
                                                    ) : (
                                                        <div className="w-4" />
                                                    )}
                                                    <div className="flex flex-col">
                                                        <span className="font-medium text-sm">{project.name}</span>
                                                        <span className="text-xs text-muted-foreground">
                                                            {project.is_active ? 'Active' : 'Completed'}
                                                            {isAssigned && activeSubProjects.length > 0 && (
                                                                <> &middot; {userSubProjectIds.filter(id => activeSubProjects.some(sp => sp.id === id)).length}/{activeSubProjects.length} sub-projects</>
                                                            )}
                                                        </span>
                                                    </div>
                                                </div>
                                                <AssignmentCheckbox
                                                    userId={userId}
                                                    projectId={project.id}
                                                    initialChecked={isAssigned}
                                                />
                                            </div>

                                            {isAssigned && isExpanded && activeSubProjects.length > 0 && (
                                                <div className="border-t bg-muted/30 px-4 py-2 space-y-1">
                                                    <p className="text-xs text-muted-foreground font-medium px-7 py-1">Sub-projects:</p>
                                                    {activeSubProjects.map(sp => (
                                                        <div key={sp.id} className="flex items-center justify-between py-2 px-7">
                                                            <div className="flex flex-col">
                                                                <span className="text-sm">{sp.code}</span>
                                                                {sp.description && (
                                                                    <span className="text-xs text-muted-foreground">{sp.description}</span>
                                                                )}
                                                            </div>
                                                            <SubProjectAssignmentCheckbox
                                                                userId={userId}
                                                                subProjectId={sp.id}
                                                                projectId={project.id}
                                                                initialChecked={userSubProjectIds.includes(sp.id)}
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}

                                {projects?.length === 0 && (
                                    <div className="text-center py-8 text-muted-foreground text-sm">
                                        No projects in the system.
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>

        <Dialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Revoke All Project Access</DialogTitle>
                    <DialogDescription>
                        This will remove <strong>{currentUser?.full_name || 'this user'}</strong> from all project assignments.
                        Their account will be preserved and access can be reassigned later. Time entries will remain in the system.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setDeactivateOpen(false)} disabled={isPending}>
                        Cancel
                    </Button>
                    <Button variant="outline" className="border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800" onClick={handleDeactivate} disabled={isPending}>
                        {isPending ? 'Revoking...' : 'Revoke Access'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <Dialog open={emailChangeOpen} onOpenChange={setEmailChangeOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Change User Email</DialogTitle>
                    <DialogDescription>
                        This will change the login email for <strong>{currentUser?.full_name || 'this user'}</strong> from <strong>{userEmail}</strong> to <strong>{newEmail}</strong>. The user will need to use the new email to sign in. All existing data will be preserved.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setEmailChangeOpen(false)} disabled={isPending}>
                        Cancel
                    </Button>
                    <Button onClick={confirmEmailChange} disabled={isPending}>
                        {isPending ? 'Changing...' : 'Confirm Change'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        </>
    )
}
