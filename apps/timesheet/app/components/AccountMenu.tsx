'use client'

import { useState, useTransition } from 'react'
import { KeyRound, LogOut } from 'lucide-react'
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
import { changePassword } from '@/app/data/actions'

export default function AccountMenu({ email }: { email: string }) {
    const [passwordOpen, setPasswordOpen] = useState(false)
    const [isPending, startTransition] = useTransition()
    const [currentPw, setCurrentPw] = useState('')
    const [newPw, setNewPw] = useState('')
    const [confirmPw, setConfirmPw] = useState('')

    const resetForm = () => {
        setCurrentPw('')
        setNewPw('')
        setConfirmPw('')
    }

    const handlePasswordChange = (e: React.FormEvent) => {
        e.preventDefault()
        if (newPw !== confirmPw) {
            toast.error('Passwords do not match')
            return
        }
        startTransition(async () => {
            const result = await changePassword(currentPw, newPw)
            if (result.error) {
                toast.error(result.error)
            } else {
                toast.success('Password changed successfully')
                setPasswordOpen(false)
                resetForm()
            }
        })
    }

    return (
        <>
            <div className="flex items-center gap-2 border-l pl-4 ml-2">
                <span className="text-sm text-gray-500 hidden sm:inline max-w-[180px] truncate">{email}</span>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPasswordOpen(true)}
                    className="gap-1.5"
                >
                    <KeyRound size={14} />
                    <span className="hidden sm:inline">Password</span>
                </Button>
                <form action="/auth/signout" method="post">
                    <Button variant="ghost" size="sm" type="submit" className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50">
                        <LogOut size={14} />
                        <span className="hidden sm:inline">Sign Out</span>
                    </Button>
                </form>
            </div>

            <Dialog open={passwordOpen} onOpenChange={(v) => { setPasswordOpen(v); if (!v) resetForm() }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Change Password</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handlePasswordChange} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="current-pw">Current Password</Label>
                            <Input
                                id="current-pw"
                                type="password"
                                value={currentPw}
                                onChange={(e) => setCurrentPw(e.target.value)}
                                autoComplete="current-password"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="new-pw">New Password</Label>
                            <Input
                                id="new-pw"
                                type="password"
                                value={newPw}
                                onChange={(e) => setNewPw(e.target.value)}
                                autoComplete="new-password"
                                minLength={6}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="confirm-pw">Confirm New Password</Label>
                            <Input
                                id="confirm-pw"
                                type="password"
                                value={confirmPw}
                                onChange={(e) => setConfirmPw(e.target.value)}
                                autoComplete="new-password"
                                minLength={6}
                                required
                            />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setPasswordOpen(false)} disabled={isPending}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isPending}>
                                {isPending ? 'Changing...' : 'Change Password'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    )
}
