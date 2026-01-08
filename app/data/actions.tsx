'use server' // To ważne! Pozwala wywoływać te funkcje też z Client Components (opcjonalnie)

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

// --- SEKCJA UŻYTKOWNIKA ---

import { Database } from '@/utils/supabase/types'

type Profile = Database['public']['Tables']['profiles']['Row']

// 1. Pobierz profil zalogowanego użytkownika (i sprawdź rolę)
export async function getUserProfile(): Promise<{ user: any, profile: Profile | null } | null> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Używamy naszej bezpiecznej funkcji is_admin() lub polityk RLS
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // Explicit cast to fix "never" type inference issue
  const profile = data as Profile | null

  return { user, profile }
}

// --- SEKCJA PROJEKTÓW ---

type Project = Database['public']['Tables']['projects']['Row']

// 2. Pobierz listę projektów (Dla Admina i Pracownika)
export async function getProjects(): Promise<Project[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Błąd pobierania projektów:', error)
    return []
  }

  return data as Project[] || []
}

// 3. Dodaj nowy projekt (Server Action do formularzy)
export async function createProject(formData: FormData) {
  const supabase = await createClient()
  const name = formData.get('name') as string

  if (!name) return { error: 'Nazwa jest wymagana' }

  const { error } = await supabase
    .from('projects')
    .insert([{ name, is_active: true }] as any)

  if (error) return { error: error.message }

  // Odśwież ścieżkę, żeby nowy projekt pojawił się na liście bez odświeżania strony
  revalidatePath('/admin/projects')
  return { success: true }
}

// --- SEKCJA TIMESHEET (CZAS PRACY) ---

// 4. Pobierz wpisy z danego tygodnia
export async function getWeeklyEntries(userId: string, startOfWeek: string, endOfWeek: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('timesheet_entries')
    .select('*')
    .eq('user_id', userId)
    .gte('work_date', startOfWeek)
    .lte('work_date', endOfWeek)

  if (error) {
    console.error('Błąd pobierania godzin:', error)
    return []
  }

  return data
}


// 5. Pobierz statystyki na dashboard
export async function getAdminStats() {
  const supabase = await createClient()

  const [projects, users] = await Promise.all([
    supabase.from('projects').select('*', { count: 'exact', head: true }),
    supabase.from('profiles').select('*', { count: 'exact', head: true })
  ])

  return {
    projectsCount: projects.count || 0,
    usersCount: users.count || 0
  }
}

// --- SEKCJA PRACOWNIKÓW (DODAJ TO DO actions.ts) ---

// 6. Pobierz listę wszystkich pracowników
export async function getUsers(): Promise<Profile[]> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .order('full_name', { ascending: true }) // lub email

  return data as Profile[] || []
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


// 9. Pobierz projekty przypisane do usera (z nazwami)
export async function getMyProjects() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  // Krok 1: Pobierz ID przypisanych projektów
  const { data: assignments } = await supabase
    .from('project_assignments')
    .select('project_id')
    .eq('user_id', user.id)

  const projectIds = (assignments as any)?.map((a: any) => a.project_id) || []

  if (projectIds.length === 0) return []

  // Krok 2: Pobierz szczegóły tych projektów
  const { data: projects } = await supabase
    .from('projects')
    .select('*')
    .in('id', projectIds)
    .eq('is_active', true) // Tylko aktywne
    .order('name')

  return projects || []
}

// 10. Zapisz/Zaktualizuj wpis (Upsert)
export async function saveWorkEntry(projectId: string, date: string, hours: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Brak sesji' }

  // Walidacja
  if (hours < 0 || hours > 24) return { error: 'Nieprawidłowa liczba godzin' }

  // Jeśli 0, to usuwamy wpis (żeby nie trzymać śmieci w bazie)
  if (hours === 0) {
    await supabase
      .from('timesheet_entries')
      .delete()
      .match({ user_id: user.id, project_id: projectId, work_date: date })

    revalidatePath('/')
    return { success: true }
  }

  // W przeciwnym razie UPSERT (Wstaw lub Aktualizuj)
  const { error } = await supabase
    .from('timesheet_entries')
    .upsert(
      {
        user_id: user.id,
        project_id: projectId,
        work_date: date,
        hours: hours
      } as any,
      { onConflict: 'user_id, project_id, work_date' }
    )

  if (error) {
    console.error("Błąd zapisu:", error)
    return { error: error.message }
  }

  revalidatePath('/')
  return { success: true }
}

type ReportEntry = {
  id: string
  work_date: string
  hours: number
  profiles: { full_name: string | null } | null
  projects: { name: string } | null
}

export async function getReportData(startDate: string, endDate: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('timesheet_entries')
    .select(`
      id,
      work_date,
      hours,
      profiles:user_id ( full_name ),
      projects:project_id ( name )
    `)
    .gte('work_date', startDate)
    .lte('work_date', endDate)
    .order('work_date', { ascending: false })

  if (error) {
    console.error('Błąd raportu:', error)
    return []
  }

  return data as unknown as ReportEntry[]
}