'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
    Plus, Trash2, Edit2, ChevronDown, ChevronUp,
    Receipt, Upload, X, Car, Loader2, FileText
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose
} from '@/components/ui/dialog'
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import {
    createExpenseTable, updateExpenseTable, deleteExpenseTable,
    saveExpenseEntry, updateExpenseEntry, deleteExpenseEntry,
    uploadReceipt, getReceiptUrl, deleteReceipt,
} from '@/app/data/actions'
import type { ExpenseTableWithProject, ExpenseEntry } from '@/app/data/actions/expenses'

type Project = { id: string; name: string; project_code: string | null }

type TableWithEntries = ExpenseTableWithProject & { entries: ExpenseEntry[] }

const EXPENSE_TYPES = [
    { value: 'taxi', label: 'Taxi' },
    { value: 'hotel', label: 'Hotel' },
    { value: 'meals', label: 'Meals' },
    { value: 'flight', label: 'Flight' },
    { value: 'parking', label: 'Parking' },
    { value: 'office_supplies', label: 'Office Supplies' },
    { value: 'personal_car', label: 'Personal Car' },
    { value: 'other', label: 'Other' },
] as const

const CURRENCIES = ['PLN', 'EUR', 'USD', 'GBP'] as const

function formatCurrency(amount: number, currency: string) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
    }).format(amount)
}

export default function ExpensesGrid({
    projects,
    tables: initialTables,
}: {
    projects: Project[]
    tables: TableWithEntries[]
}) {
    const router = useRouter()
    const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>(
        () => Object.fromEntries(initialTables.map(t => [t.id, true]))
    )

    const toggleTable = (id: string) => {
        setExpandedTables(prev => ({ ...prev, [id]: !prev[id] }))
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <p className="text-sm text-gray-500">
                    {initialTables.length === 0 ? 'No expense tables yet.' : `${initialTables.length} expense table${initialTables.length === 1 ? '' : 's'}`}
                </p>
                <CreateTableDialog projects={projects} />
            </div>

            {initialTables.map(table => (
                <ExpenseTableCard
                    key={table.id}
                    table={table}
                    projects={projects}
                    expanded={expandedTables[table.id] ?? true}
                    onToggle={() => toggleTable(table.id)}
                />
            ))}
        </div>
    )
}

// ─── Create Expense Table Dialog ───

function CreateTableDialog({ projects }: { projects: Project[] }) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [projectId, setProjectId] = useState('')
    const [workOrder, setWorkOrder] = useState('')
    const [purpose, setPurpose] = useState('')
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')

    const handleCreate = async () => {
        if (!projectId || !startDate || !endDate) {
            toast.error('Project, start date, and end date are required')
            return
        }
        setLoading(true)
        const result = await createExpenseTable({
            projectId, workOrder, purpose, startDate, endDate
        })
        setLoading(false)
        if ('error' in result) {
            toast.error(result.error)
        } else {
            toast.success('Expense table created')
            setOpen(false)
            setProjectId('')
            setWorkOrder('')
            setPurpose('')
            setStartDate('')
            setEndDate('')
            router.refresh()
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button><Plus size={16} className="mr-2" /> Create Expense Table</Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create Expense Table</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div>
                        <Label>Project *</Label>
                        <Select value={projectId} onValueChange={setProjectId}>
                            <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                            <SelectContent>
                                {projects.map(p => (
                                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label>Work Order</Label>
                        <Input value={workOrder} onChange={e => setWorkOrder(e.target.value)} placeholder="Code/reference" />
                    </div>
                    <div>
                        <Label>Purpose</Label>
                        <Input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Trip/assignment purpose" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label>Start Date *</Label>
                            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                        </div>
                        <div>
                            <Label>End Date *</Label>
                            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                    <Button onClick={handleCreate} disabled={loading}>
                        {loading && <Loader2 size={16} className="mr-2 animate-spin" />}
                        Create
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ─── Expense Table Card ───

function ExpenseTableCard({
    table,
    projects,
    expanded,
    onToggle,
}: {
    table: TableWithEntries
    projects: Project[]
    expanded: boolean
    onToggle: () => void
}) {
    const router = useRouter()
    const [deleting, setDeleting] = useState(false)

    const handleDelete = async () => {
        if (!confirm('Delete this expense table and all its entries?')) return
        setDeleting(true)
        const result = await deleteExpenseTable(table.id)
        setDeleting(false)
        if ('error' in result) {
            toast.error(result.error)
        } else {
            toast.success('Expense table deleted')
            router.refresh()
        }
    }

    // Calculate totals by currency
    const totalsByCurrency: Record<string, number> = {}
    for (const entry of table.entries) {
        totalsByCurrency[entry.currency] = (totalsByCurrency[entry.currency] || 0) + Number(entry.amount)
    }

    return (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {/* Header */}
            <div
                className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition"
                onClick={onToggle}
            >
                <div className="flex items-center gap-3 min-w-0">
                    {expanded ? <ChevronUp size={18} className="text-gray-400 shrink-0" /> : <ChevronDown size={18} className="text-gray-400 shrink-0" />}
                    <div className="min-w-0">
                        <div className="font-semibold text-gray-900 truncate">{table.project_name}</div>
                        <div className="text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
                            <span>{table.start_date} — {table.end_date}</span>
                            {table.work_order && <span>WO: {table.work_order}</span>}
                            {table.purpose && <span>{table.purpose}</span>}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                    <EditTableDialog table={table} projects={projects} />
                    <Button variant="ghost" size="icon" onClick={handleDelete} disabled={deleting} className="text-red-500 hover:text-red-700 hover:bg-red-50">
                        {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                    </Button>
                </div>
            </div>

            {/* Content */}
            {expanded && (
                <div className="p-4">
                    {/* Desktop table */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b text-left text-gray-500">
                                    <th className="pb-2 pr-2 font-medium">Date</th>
                                    <th className="pb-2 pr-2 font-medium">Location</th>
                                    <th className="pb-2 pr-2 font-medium">Type</th>
                                    <th className="pb-2 pr-2 font-medium">Description</th>
                                    <th className="pb-2 pr-2 font-medium">Currency</th>
                                    <th className="pb-2 pr-2 font-medium text-right">Amount</th>
                                    <th className="pb-2 pr-2 font-medium">Receipt</th>
                                    <th className="pb-2 font-medium w-20">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {table.entries.map(entry => (
                                    <EntryRow key={entry.id} entry={entry} />
                                ))}
                                {table.entries.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="text-center py-6 text-gray-400">No expenses yet</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile cards */}
                    <div className="md:hidden space-y-3">
                        {table.entries.map(entry => (
                            <MobileEntryCard key={entry.id} entry={entry} />
                        ))}
                        {table.entries.length === 0 && (
                            <p className="text-center py-6 text-gray-400 text-sm">No expenses yet</p>
                        )}
                    </div>

                    {/* Footer: totals + add button */}
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mt-4 pt-3 border-t">
                        <div className="text-sm font-medium text-gray-700">
                            {Object.keys(totalsByCurrency).length > 0 ? (
                                <span>Total: {Object.entries(totalsByCurrency).map(([cur, amt]) => formatCurrency(amt, cur)).join(' + ')}</span>
                            ) : (
                                <span className="text-gray-400">No entries</span>
                            )}
                        </div>
                        <AddEntryDialog tableId={table.id} />
                    </div>
                </div>
            )}
        </div>
    )
}

// ─── Entry Row (Desktop) ───

function EntryRow({ entry }: { entry: ExpenseEntry }) {
    const router = useRouter()
    const [deleting, setDeleting] = useState(false)

    const handleDelete = async () => {
        if (!confirm('Delete this expense entry?')) return
        setDeleting(true)
        const result = await deleteExpenseEntry(entry.id)
        setDeleting(false)
        if ('error' in result) toast.error(result.error)
        else {
            toast.success('Entry deleted')
            router.refresh()
        }
    }

    const dateStr = entry.expense_date_end
        ? `${entry.expense_date} — ${entry.expense_date_end}`
        : entry.expense_date

    const typeLabel = EXPENSE_TYPES.find(t => t.value === entry.expense_type)?.label ?? entry.expense_type

    const isPersonalCar = entry.expense_type === 'personal_car'

    return (
        <tr className="border-b last:border-b-0 hover:bg-gray-50">
            <td className="py-2 pr-2 whitespace-nowrap">{dateStr}</td>
            <td className="py-2 pr-2">{entry.location || '—'}</td>
            <td className="py-2 pr-2 whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                    {isPersonalCar && <Car size={14} />}
                    {typeLabel}
                </span>
            </td>
            <td className="py-2 pr-2 max-w-[200px] truncate">
                {isPersonalCar && entry.km != null && entry.km_rate != null
                    ? `${entry.km} km × ${entry.km_rate}/km`
                    : entry.description || '—'
                }
            </td>
            <td className="py-2 pr-2">{entry.currency}</td>
            <td className="py-2 pr-2 text-right font-medium">{formatCurrency(Number(entry.amount), entry.currency)}</td>
            <td className="py-2 pr-2">
                <ReceiptActions entryId={entry.id} hasReceipt={!!entry.receipt_path} />
            </td>
            <td className="py-2">
                <div className="flex items-center gap-1">
                    <EditEntryDialog entry={entry} />
                    <Button variant="ghost" size="icon" onClick={handleDelete} disabled={deleting} className="h-7 w-7 text-red-500 hover:text-red-700">
                        {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </Button>
                </div>
            </td>
        </tr>
    )
}

// ─── Mobile Entry Card ───

function MobileEntryCard({ entry }: { entry: ExpenseEntry }) {
    const router = useRouter()
    const [deleting, setDeleting] = useState(false)

    const handleDelete = async () => {
        if (!confirm('Delete this expense entry?')) return
        setDeleting(true)
        const result = await deleteExpenseEntry(entry.id)
        setDeleting(false)
        if ('error' in result) toast.error(result.error)
        else {
            toast.success('Entry deleted')
            router.refresh()
        }
    }

    const typeLabel = EXPENSE_TYPES.find(t => t.value === entry.expense_type)?.label ?? entry.expense_type
    const isPersonalCar = entry.expense_type === 'personal_car'

    return (
        <div className="border rounded-lg p-3 space-y-2">
            <div className="flex justify-between items-start">
                <div>
                    <div className="font-medium text-sm flex items-center gap-1">
                        {isPersonalCar && <Car size={14} />}
                        {typeLabel}
                    </div>
                    <div className="text-xs text-gray-500">
                        {entry.expense_date}{entry.expense_date_end ? ` — ${entry.expense_date_end}` : ''}
                        {entry.location && ` · ${entry.location}`}
                    </div>
                </div>
                <div className="text-right">
                    <div className="font-semibold text-sm">{formatCurrency(Number(entry.amount), entry.currency)}</div>
                    <div className="text-xs text-gray-500">{entry.currency}</div>
                </div>
            </div>
            {isPersonalCar && entry.km != null && entry.km_rate != null && (
                <div className="text-xs text-gray-600">{entry.km} km × {entry.km_rate}/km</div>
            )}
            {entry.description && !isPersonalCar && (
                <div className="text-xs text-gray-600">{entry.description}</div>
            )}
            <div className="flex items-center gap-2 pt-1">
                <ReceiptActions entryId={entry.id} hasReceipt={!!entry.receipt_path} />
                <div className="ml-auto flex items-center gap-1">
                    <EditEntryDialog entry={entry} />
                    <Button variant="ghost" size="icon" onClick={handleDelete} disabled={deleting} className="h-7 w-7 text-red-500 hover:text-red-700">
                        {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </Button>
                </div>
            </div>
        </div>
    )
}

// ─── Receipt Actions ───

function ReceiptActions({ entryId, hasReceipt }: { entryId: string; hasReceipt: boolean }) {
    const router = useRouter()
    const fileRef = useRef<HTMLInputElement>(null)
    const [uploading, setUploading] = useState(false)
    const [loadingUrl, setLoadingUrl] = useState(false)

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setUploading(true)
        const formData = new FormData()
        formData.append('file', file)
        const result = await uploadReceipt(entryId, formData)
        setUploading(false)
        if ('error' in result) toast.error(result.error)
        else {
            toast.success('Receipt uploaded')
            router.refresh()
        }
        if (fileRef.current) fileRef.current.value = ''
    }

    const handleView = async () => {
        setLoadingUrl(true)
        const result = await getReceiptUrl(entryId)
        setLoadingUrl(false)
        if ('error' in result) toast.error(result.error)
        else if (result.url) window.open(result.url, '_blank')
    }

    const handleDeleteReceipt = async () => {
        if (!confirm('Remove receipt?')) return
        const result = await deleteReceipt(entryId)
        if ('error' in result) toast.error(result.error)
        else {
            toast.success('Receipt removed')
            router.refresh()
        }
    }

    if (hasReceipt) {
        return (
            <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={handleView} disabled={loadingUrl} className="h-7 w-7 text-green-600" title="View receipt">
                    {loadingUrl ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                </Button>
                <Button variant="ghost" size="icon" onClick={handleDeleteReceipt} className="h-7 w-7 text-red-400" title="Remove receipt">
                    <X size={14} />
                </Button>
            </div>
        )
    }

    return (
        <>
            <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleUpload} />
            <Button
                variant="ghost"
                size="icon"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="h-7 w-7 text-gray-400"
                title="Upload receipt"
            >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            </Button>
        </>
    )
}

// ─── Add Entry Dialog ───

function AddEntryDialog({ tableId }: { tableId: string }) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const fileRef = useRef<HTMLInputElement>(null)

    const [date, setDate] = useState('')
    const [dateEnd, setDateEnd] = useState('')
    const [location, setLocation] = useState('')
    const [type, setType] = useState('')
    const [description, setDescription] = useState('')
    const [currency, setCurrency] = useState('PLN')
    const [amount, setAmount] = useState('')
    const [km, setKm] = useState('')
    const [kmRate, setKmRate] = useState('0.8358')

    const isPersonalCar = type === 'personal_car'
    const computedAmount = isPersonalCar && km && kmRate
        ? (parseFloat(km) * parseFloat(kmRate)).toFixed(2)
        : amount

    const resetForm = () => {
        setDate('')
        setDateEnd('')
        setLocation('')
        setType('')
        setDescription('')
        setCurrency('PLN')
        setAmount('')
        setKm('')
        setKmRate('0.8358')
    }

    const handleSave = async () => {
        if (!date || !type || !computedAmount || parseFloat(computedAmount) <= 0) {
            toast.error('Date, type, and a positive amount are required')
            return
        }
        setLoading(true)
        const result = await saveExpenseEntry({
            tableId,
            date,
            dateEnd: dateEnd || undefined,
            location,
            type,
            description,
            currency,
            amount: parseFloat(computedAmount),
            km: isPersonalCar && km ? parseFloat(km) : undefined,
            kmRate: isPersonalCar && kmRate ? parseFloat(kmRate) : undefined,
        })

        if ('error' in result) {
            toast.error(result.error)
            setLoading(false)
            return
        }

        // Upload receipt if file selected
        const file = fileRef.current?.files?.[0]
        if (file && result.id) {
            const formData = new FormData()
            formData.append('file', file)
            await uploadReceipt(result.id, formData)
        }

        setLoading(false)
        toast.success('Expense added')
        setOpen(false)
        resetForm()
        router.refresh()
    }

    return (
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
            <DialogTrigger asChild>
                <Button size="sm" variant="outline"><Plus size={14} className="mr-1" /> Add Expense</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Add Expense</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label>Date *</Label>
                            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                        </div>
                        <div>
                            <Label>End Date</Label>
                            <Input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} />
                        </div>
                    </div>
                    <div>
                        <Label>Location</Label>
                        <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="City / place" />
                    </div>
                    <div>
                        <Label>Type *</Label>
                        <Select value={type} onValueChange={setType}>
                            <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                            <SelectContent>
                                {EXPENSE_TYPES.map(t => (
                                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label>Description</Label>
                        <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Notes" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label>Currency *</Label>
                            <Select value={currency} onValueChange={setCurrency}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {CURRENCIES.map(c => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {isPersonalCar ? (
                            <div>
                                <Label>Amount (auto)</Label>
                                <Input value={computedAmount} disabled className="bg-gray-50" />
                            </div>
                        ) : (
                            <div>
                                <Label>Amount *</Label>
                                <Input type="number" step="0.01" min="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
                            </div>
                        )}
                    </div>
                    {isPersonalCar && (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Label>Kilometers *</Label>
                                <Input type="number" step="0.01" min="0" value={km} onChange={e => setKm(e.target.value)} placeholder="km" />
                            </div>
                            <div>
                                <Label>Rate per km *</Label>
                                <Input type="number" step="0.0001" min="0" value={kmRate} onChange={e => setKmRate(e.target.value)} />
                            </div>
                        </div>
                    )}
                    <div>
                        <Label>Receipt (optional)</Label>
                        <Input ref={fileRef} type="file" accept="image/*,.pdf" />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                    <Button onClick={handleSave} disabled={loading}>
                        {loading && <Loader2 size={16} className="mr-2 animate-spin" />}
                        Add
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ─── Edit Table Dialog ───

function EditTableDialog({ table, projects }: { table: ExpenseTableWithProject; projects: Project[] }) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [projectId, setProjectId] = useState(table.project_id)
    const [workOrder, setWorkOrder] = useState(table.work_order || '')
    const [purpose, setPurpose] = useState(table.purpose || '')
    const [startDate, setStartDate] = useState(table.start_date)
    const [endDate, setEndDate] = useState(table.end_date)

    const handleSave = async () => {
        if (!projectId || !startDate || !endDate) {
            toast.error('Project, start date, and end date are required')
            return
        }
        setLoading(true)
        const result = await updateExpenseTable(table.id, {
            projectId, workOrder, purpose, startDate, endDate
        })
        setLoading(false)
        if ('error' in result) toast.error(result.error)
        else {
            toast.success('Table updated')
            setOpen(false)
            router.refresh()
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8"><Edit2 size={14} /></Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader><DialogTitle>Edit Expense Table</DialogTitle></DialogHeader>
                <div className="space-y-4 py-2">
                    <div>
                        <Label>Project *</Label>
                        <Select value={projectId} onValueChange={setProjectId}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {projects.map(p => (
                                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label>Work Order</Label>
                        <Input value={workOrder} onChange={e => setWorkOrder(e.target.value)} />
                    </div>
                    <div>
                        <Label>Purpose</Label>
                        <Input value={purpose} onChange={e => setPurpose(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label>Start Date *</Label>
                            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                        </div>
                        <div>
                            <Label>End Date *</Label>
                            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                    <Button onClick={handleSave} disabled={loading}>
                        {loading && <Loader2 size={16} className="mr-2 animate-spin" />}
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ─── Edit Entry Dialog ───

function EditEntryDialog({ entry }: { entry: ExpenseEntry }) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)

    const [date, setDate] = useState(entry.expense_date)
    const [dateEnd, setDateEnd] = useState(entry.expense_date_end || '')
    const [location, setLocation] = useState(entry.location || '')
    const [type, setType] = useState(entry.expense_type)
    const [description, setDescription] = useState(entry.description || '')
    const [currency, setCurrency] = useState(entry.currency)
    const [amount, setAmount] = useState(String(entry.amount))
    const [km, setKm] = useState(entry.km != null ? String(entry.km) : '')
    const [kmRate, setKmRate] = useState(entry.km_rate != null ? String(entry.km_rate) : '0.8358')

    const isPersonalCar = type === 'personal_car'
    const computedAmount = isPersonalCar && km && kmRate
        ? (parseFloat(km) * parseFloat(kmRate)).toFixed(2)
        : amount

    const handleSave = async () => {
        const finalAmount = parseFloat(computedAmount)
        if (!date || !type || !finalAmount || finalAmount <= 0) {
            toast.error('Date, type, and a positive amount are required')
            return
        }
        setLoading(true)
        const result = await updateExpenseEntry(entry.id, {
            date,
            dateEnd: dateEnd || null,
            location,
            type,
            description,
            currency,
            amount: finalAmount,
            km: isPersonalCar && km ? parseFloat(km) : null,
            kmRate: isPersonalCar && kmRate ? parseFloat(kmRate) : null,
        })
        setLoading(false)
        if ('error' in result) toast.error(result.error)
        else {
            toast.success('Entry updated')
            setOpen(false)
            router.refresh()
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7"><Edit2 size={14} /></Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Edit Expense</DialogTitle></DialogHeader>
                <div className="space-y-3 py-2">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label>Date *</Label>
                            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                        </div>
                        <div>
                            <Label>End Date</Label>
                            <Input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} />
                        </div>
                    </div>
                    <div>
                        <Label>Location</Label>
                        <Input value={location} onChange={e => setLocation(e.target.value)} />
                    </div>
                    <div>
                        <Label>Type *</Label>
                        <Select value={type} onValueChange={setType}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {EXPENSE_TYPES.map(t => (
                                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label>Description</Label>
                        <Input value={description} onChange={e => setDescription(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label>Currency *</Label>
                            <Select value={currency} onValueChange={setCurrency}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {CURRENCIES.map(c => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {isPersonalCar ? (
                            <div>
                                <Label>Amount (auto)</Label>
                                <Input value={computedAmount} disabled className="bg-gray-50" />
                            </div>
                        ) : (
                            <div>
                                <Label>Amount *</Label>
                                <Input type="number" step="0.01" min="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
                            </div>
                        )}
                    </div>
                    {isPersonalCar && (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Label>Kilometers *</Label>
                                <Input type="number" step="0.01" min="0" value={km} onChange={e => setKm(e.target.value)} />
                            </div>
                            <div>
                                <Label>Rate per km *</Label>
                                <Input type="number" step="0.0001" min="0" value={kmRate} onChange={e => setKmRate(e.target.value)} />
                            </div>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                    <Button onClick={handleSave} disabled={loading}>
                        {loading && <Loader2 size={16} className="mr-2 animate-spin" />}
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
