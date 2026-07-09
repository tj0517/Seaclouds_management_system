'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { inviteUser } from '@/app/data/actions'

export default function InviteUserDialog() {
    const [open, setOpen] = useState(false)
    const [isPending, startTransition] = useTransition()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [fullName, setFullName] = useState('')
    const router = useRouter()

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const formData = new FormData(e.currentTarget)
        startTransition(async () => {
            const result = await inviteUser(formData)
            if (result.error) {
                toast.error(`Error: ${result.error}`)
            } else {
                toast.success('User created successfully')
                setOpen(false)
                setEmail('')
                setPassword('')
                setFullName('')
                router.refresh()
            }
        })
    }

    return (
        <>
            <Button onClick={() => setOpen(true)}>
                <UserPlus className="mr-2 h-4 w-4" /> Add User
            </Button>
            <Dialog open={open} onOpenChange={(v) => {
                setOpen(v)
                if (!v) { setEmail(''); setPassword(''); setFullName('') }
            }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add User</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="invite-email">Email</Label>
                            <Input
                                id="invite-email"
                                name="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                autoComplete="off"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="invite-password">Password</Label>
                            <Input
                                id="invite-password"
                                name="password"
                                type="text"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="off"
                                minLength={6}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="invite-fullname">Full Name</Label>
                            <Input
                                id="invite-fullname"
                                name="full_name"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                autoComplete="off"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="role">Role</Label>
                            <Select name="role" defaultValue="employee">
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
                        <div className="space-y-2">
                            <Label htmlFor="invite-employee-id">Employee ID</Label>
                            <Input
                                id="invite-employee-id"
                                name="employee_id"
                                placeholder="e.g. EMP-001"
                                autoComplete="off"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="invite-position">Position</Label>
                            <Input
                                id="invite-position"
                                name="position"
                                placeholder="e.g. Software Engineer"
                                autoComplete="off"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="invite-rate-hourly">Hourly Rate</Label>
                                <Input
                                    id="invite-rate-hourly"
                                    name="rate_hourly"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder="0.00"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="invite-rate-daily">Daily Rate</Label>
                                <Input
                                    id="invite-rate-daily"
                                    name="rate_daily"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder="0.00"
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isPending}>
                                {isPending ? 'Creating...' : 'Create User'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    )
}
