'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Loader2, ArrowLeft, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createProject } from '@/app/data/actions'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import { getUsers, toggleProjectAssignment, findProject } from '@/app/data/actions'
import { Database } from '@/utils/supabase/types'

export default function NewProjectPage() {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  type Profile = Database['public']['Tables']['profiles']['Row']
  const [workers, setWorkers] = useState<Profile[]>([])
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  useEffect(() => {
    getUsers().then(setWorkers)
  }, [])

  const toggleUser = (userId: string) => {
    setSelectedUsers(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    )
  }





  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const formData = new FormData()
    formData.append('name', name)
    formData.append('project_code', code)

    // Append selected users manually
    selectedUsers.forEach(userId => {
      formData.append('user_id', userId)
    })

    const result = await createProject(formData)

    const project = await findProject(name)
    if (project?.id) {
      selectedUsers.forEach(userId => {
        toggleProjectAssignment(userId, project?.id, true)
      })
    }


    if (result && 'error' in result) {
      toast.error(result.error || 'Błąd podczas tworzenia projektu')
    } else {
      setName('')
      setCode('')
      router.push('/admin/projects')
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <div className=" mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/projects">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Nowy Projekt</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Utwórz projekt</CardTitle>
          <CardDescription>
            Wprowadź nazwę nowego projektu. Projekt zostanie automatycznie oznaczony jako aktywny.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2  w-full items-center gap-1.5">
              <Input
                type="text"
                name="name"
                placeholder="Name of Project"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Input
                type="text"
                name="project_code"
                placeholder="Project code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <div className="col-span-full pt-4">
                <label className="mb-4 block text-sm font-medium">Assign User</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {workers.length === 0 ? (
                    <p className="text-sm text-muted-foreground col-span-full">Loading users...</p>
                  ) : (
                    workers.map((worker) => (
                      <div key={worker.id} className="relative">
                        <input
                          type="checkbox"
                          id={worker.id}
                          checked={selectedUsers.includes(worker.id)}
                          onChange={() => toggleUser(worker.id)}
                          className="peer sr-only"
                        />
                        <label
                          htmlFor={worker.id}
                          className="flex flex-col items-center justify-center rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-checked:border-primary peer-checked:bg-primary/5 cursor-pointer transition-all gap-2 text-center"
                        >
                          <div className="p-2 bg-muted rounded-full">
                            <User className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <span className="text-sm font-medium leading-none">
                            {worker.full_name || 'Unknown User'}
                          </span>
                        </label>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={loading || !name.trim()}
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                {loading ? 'Tworzenie...' : 'Utwórz Projekt'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}