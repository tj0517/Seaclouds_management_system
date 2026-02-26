'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { Database } from '@/utils/supabase/types'

type Project = Database['public']['Tables']['projects']['Row']
type SubProject = Database['public']['Tables']['sub_projects']['Row']

// 2. Pobierz listę projektów (Dla Admina i Pracownika)
export async function getProjects(): Promise<Project[]> {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false })

    if (error) {
        return []
    }

    return data as Project[] || []
}

export async function findProject(name: string): Promise<Project | null> {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('name', name)
        .order('created_at', { ascending: false })

    if (error) {
        return null
    }

    return data[0] || null
}



export async function getProjectById(id: string): Promise<Project | null> {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .single()

    if (error) {
        return null
    }

    return data
}

// 3. Dodaj nowy projekt (Server Action do formularzy)
export async function createProject(formData: FormData) {
    const supabase = await createClient()
    const name = formData.get('name') as string
    const project_code = formData.get('project_code') as string
    const user_ids = formData.getAll('user_id') as string[]

    if (!name) return { error: 'Nazwa jest wymagana' }

    // 1. Utwórz projekt
    const { data: project, error: projectError } = await supabase
        .from('projects')
        .insert([{ name, is_active: true, project_code }] as any)
        .select()
        .single()

    if (projectError) return { error: projectError.message }

    // 2. Jeśli wybrano pracowników, przypisz ich do projektu
    if (user_ids.length > 0 && project) {
        const assignments = user_ids.map(userId => ({
            project_id: project.id,
            user_id: userId
        }))

        const { error: assignmentError } = await supabase
            .from('project_assignments')
            .insert(assignments as any)

        // Assignment failure is non-fatal: project was created successfully.
        // Supabase doesn't support transactions via the REST API, so we accept partial success here.
    }

    // Odśwież ścieżkę, żeby nowy projekt pojawił się na liście bez odświeżania strony
    revalidatePath('/admin/projects')
    return { success: true }
}

// 7. Pobierz projekty przypisane do konkretnego pracownika
export async function getUserAssignments(userId: string) {
    const supabase = await createClient()

    const { data } = await supabase
        .from('project_assignments')
        .select('project_id')
        .eq('user_id', userId)

    // Zwracamy tablicę samych ID projektów: ['uuid-1', 'uuid-2']
    return (data as any)?.map((a: any) => a.project_id) || []
}

// 7a. Pobierz pracowników przypisanych do konkretnego projektu
export async function getProjectAssignments(projectId: string) {
    const supabase = await createClient()

    const { data } = await supabase
        .from('project_assignments')
        .select('user_id')
        .eq('project_id', projectId)

    // Zwracamy tablicę samych ID użytkowników: ['uuid-1', 'uuid-2']
    return (data as any)?.map((a: any) => a.user_id) || []
}

// 8. Przypisz/Odbierz projekt (Toggle)
export async function toggleProjectAssignment(userId: string, projectId: string, isAssigned: boolean) {
    const supabase = await createClient()

    if (isAssigned) {
        // Jeśli ma być przypisany -> Dodajemy (Insert)
        // ignoreDuplicates: true sprawia, że jak już jest, to nie wywali błędu
        await supabase
            .from('project_assignments')
            .insert([{ user_id: userId, project_id: projectId }] as any)
            .select()
    } else {
        // Jeśli ma być zabrany -> Usuwamy (Delete)
        await supabase
            .from('project_assignments')
            .delete()
            .match({ user_id: userId, project_id: projectId })
    }

    revalidatePath(`/admin/users/${userId}`)
}

export async function fetchSubProjects(projectId: string) {
    const supabase = await createClient()

    const { data } = await supabase
        .from('sub_projects')
        .select('*')
        .eq('project_id', projectId)

    return data as SubProject[] || []
}

export async function getAllSubProjects(projectIds: string[]) {
    const supabase = await createClient()

    if (projectIds.length === 0) return []

    const { data } = await supabase
        .from('sub_projects')
        .select('*')
        .in('project_id', projectIds)
        .eq('is_active', true)

    return data as SubProject[] || []
}

export async function createSubProject(formData: FormData) {
    const supabase = await createClient()
    const projectId = formData.get('project_id') as string
    const code = formData.get('code') as string
    const description = formData.get('description') as string

    if (!code) return { error: 'Kod jest wymagany' }
    if (!projectId) return { error: 'ID projektu jest wymagane' }

    const { error } = await supabase
        .from('sub_projects')
        .insert({
            project_id: projectId,
            code: code,
            description: description,
            is_active: true
        })

    if (error) {
        return { error: error.message }
    }

    revalidatePath(`/admin/projects/${projectId}`)
    return { success: true }
}

export async function updateProject(id: string, formData: FormData) {
    const supabase = await createClient()
    const name = formData.get('name') as string
    const project_code = formData.get('project_code') as string
    const description = formData.get('description') as string
    const is_active = formData.get('is_active') === 'true'

    if (!name) return { error: 'Nazwa jest wymagana' }

    const { error } = await supabase
        .from('projects')
        .update({ name, project_code, description, is_active } as any)
        .eq('id', id)

    if (error) return { error: error.message }

    revalidatePath(`/admin/projects/${id}`)
    revalidatePath('/admin/projects')
    return { success: true }
}

export async function deleteProject(id: string) {
    const supabase = await createClient()

    // Check for timesheet entries through sub_projects
    const { data: subProjects } = await supabase
        .from('sub_projects')
        .select('id')
        .eq('project_id', id)

    const subProjectIds = subProjects?.map(s => s.id) || []

    if (subProjectIds.length > 0) {
        const { count } = await supabase
            .from('timesheet_entries')
            .select('*', { count: 'exact', head: true })
            .in('sub_project_id', subProjectIds)

        if (count && count > 0) {
            // Soft delete: deactivate instead of hard delete
            const { error } = await supabase
                .from('projects')
                .update({ is_active: false } as any)
                .eq('id', id)

            if (error) return { error: error.message }

            revalidatePath('/admin/projects')
            return { success: true, softDeleted: true }
        }
    }

    // Hard delete if no entries exist
    const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id)

    if (error) return { error: error.message }

    revalidatePath('/admin/projects')
    return { success: true, softDeleted: false }
}

export async function toggleSubProjectStatus(id: string, projectId: string, isActive: boolean) {
    const supabase = await createClient()

    const { error } = await supabase
        .from('sub_projects')
        .update({ is_active: isActive })
        .eq('id', id)

    if (error) {
        return { error: error.message }
    }

    revalidatePath(`/admin/projects/${projectId}`)
    return { success: true }
}
