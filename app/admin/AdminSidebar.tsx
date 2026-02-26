'use client'

import { useState } from 'react'
import Link from 'next/link'
import { LayoutDashboard, FolderKanban, Users, LogOut, FileText, Clock, Menu, X } from 'lucide-react'

const navLinks = [
    { href: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/admin/projects', icon: FolderKanban, label: 'Projekty' },
    { href: '/admin/users', icon: Users, label: 'Pracownicy' },
    { href: '/admin/reports', icon: FileText, label: 'Raporty' },
    { href: '/', icon: Clock, label: 'Raportuj godziny' },
]

export default function AdminSidebar({ email }: { email: string }) {
    const [open, setOpen] = useState(false)

    const sidebarContent = (
        <>
            <div className="p-6 border-b">
                <h1 className="text-xl font-bold text-blue-600">Admin Panel</h1>
                <p className="text-xs text-gray-500 mt-1">{email}</p>
            </div>
            <nav className="flex-1 p-4 space-y-2">
                {navLinks.map(({ href, icon: Icon, label }) => (
                    <Link
                        key={href}
                        href={href}
                        onClick={() => setOpen(false)}
                        className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                        <Icon size={20} />
                        {label}
                    </Link>
                ))}
            </nav>
            <div className="p-4 border-t">
                <form action="/auth/signout" method="post">
                    <button className="flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 w-full rounded-lg">
                        <LogOut size={20} />
                        Wyloguj
                    </button>
                </form>
            </div>
        </>
    )

    return (
        <>
            {/* Mobile hamburger */}
            <button
                className="md:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-md"
                onClick={() => setOpen(true)}
                aria-label="Otwórz menu"
            >
                <Menu size={20} />
            </button>

            {/* Mobile overlay */}
            {open && (
                <div
                    className="md:hidden fixed inset-0 bg-black/40 z-40"
                    onClick={() => setOpen(false)}
                />
            )}

            {/* Mobile drawer */}
            <aside
                className={`md:hidden fixed top-0 left-0 h-full w-64 bg-white shadow-md flex flex-col z-50 transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'}`}
            >
                <div className="flex justify-end p-2">
                    <button onClick={() => setOpen(false)} className="p-2 hover:bg-gray-100 rounded-lg" aria-label="Zamknij menu">
                        <X size={20} />
                    </button>
                </div>
                {sidebarContent}
            </aside>

            {/* Desktop sidebar */}
            <aside className="hidden md:flex w-64 bg-white shadow-md flex-col flex-shrink-0">
                {sidebarContent}
            </aside>
        </>
    )
}
