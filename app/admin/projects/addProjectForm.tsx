// app/admin/projects/AddProjectForm.tsx
'use client'

import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'


export default function AddProjectForm() {
  const supabase = createClient()
  const router = useRouter()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setLoading(true)
    const { error } = await supabase
      .from('projects')
      // Implicit cast handled by supabase-js if types generated correctly, else rely on server action logic or simple insert
      .insert([{ name, is_active: true }])

    if (!error) {
      setName('')
      router.refresh()
    } else {
      alert('Błąd dodawania projektu')
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-4">
      <Input
        type="text"
        placeholder="Nazwa nowego projektu..."
        className="flex-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button
        type="submit"
        disabled={loading}
      >
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
        {loading ? 'Dodawanie...' : 'Dodaj'}
      </Button>
    </form>
  )
}