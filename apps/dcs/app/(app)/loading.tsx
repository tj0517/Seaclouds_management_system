// Project list: header with the "New project MDR" action, then the 5-column
// table (Code / Name / Cycle / Team / Status).
import { ListPageSkeleton } from '@/components/skeletons'

export default function Loading() {
  return <ListPageSkeleton action rows={5} cols={5} />
}
