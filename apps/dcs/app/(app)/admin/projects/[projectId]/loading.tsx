// Project MDR summary: six stat tiles, then one card per team member.
// This is also the feedback for the per-row "Team" link, which cannot carry
// its own indicator — see the comment in app/(app)/page.tsx.
import { DetailPageSkeleton } from '@/components/skeletons'

export default function Loading() {
  return <DetailPageSkeleton tiles={6} cards={3} />
}
