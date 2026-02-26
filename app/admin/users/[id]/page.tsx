
import { getProjects, getUserAssignments, getUsers } from '@/app/data/actions'
import UserDetailsClient from './userDetailsClient'

export default async function UserDetailsPage({
  params
}: {
  params: Promise<{ id: string }>
}) {

  const { id } = await params;
  const userId = id;

  const [projects, assignedProjectIds, users] = await Promise.all([
    getProjects(),
    getUserAssignments(userId),
    getUsers()
  ])

  const currentUser = users.find(u => u.id === userId)

  return (
    <UserDetailsClient
      currentUser={currentUser}
      userId={userId}
      projects={projects}
      assignedProjectIds={assignedProjectIds}
    />
  )
}