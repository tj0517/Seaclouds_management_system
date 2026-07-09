
import { getProjects, getUserAssignments, getUsers, fetchSubProjects, getUserSubProjectAssignments } from '@/app/data/actions'
import { getUserRoleAndProjects } from '@/app/data/actions/auth-helpers'
import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/utils/supabase/admin'
import UserDetailsClient from './userDetailsClient'

export default async function UserDetailsPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const roleInfo = await getUserRoleAndProjects()
  if (!roleInfo || roleInfo.role === 'project_lead') redirect('/admin')

  const { id } = await params;
  const userId = id;

  const [projects, assignedProjectIds, users, userSubProjectIds, authUser] = await Promise.all([
    getProjects(),
    getUserAssignments(userId),
    getUsers(),
    getUserSubProjectAssignments(userId),
    getSupabaseAdmin().auth.admin.getUserById(userId),
  ])

  const userEmail = authUser.data?.user?.email || null

  // Fetch sub-projects for all assigned projects
  const subProjectsByProject: Record<string, { id: string; code: string; description: string | null; is_active: boolean | null; project_id: string }[]> = {}
  const assignedSubProjects = await Promise.all(
    assignedProjectIds.map((pid: string) => fetchSubProjects(pid))
  )
  assignedProjectIds.forEach((pid: string, i: number) => {
    subProjectsByProject[pid] = assignedSubProjects[i]
  })

  const currentUser = users.find(u => u.id === userId)

  return (
    <UserDetailsClient
      currentUser={currentUser}
      userId={userId}
      projects={projects}
      assignedProjectIds={assignedProjectIds}
      subProjectsByProject={subProjectsByProject}
      userSubProjectIds={userSubProjectIds}
      userEmail={userEmail}
    />
  )
}