// Dictionaries: header, the 7-tab strip, the "show inactive" row, then the
// Document Type table (the tab that opens by default, 7 columns).
import { Skeleton } from '@/components/ui/skeleton'
import { PageBody } from '@/components/page-chrome'
import { HeaderSkeleton, TableSkeleton } from '@/components/skeletons'

export default function Loading() {
  return (
    <PageBody>
      <HeaderSkeleton />
      <div className="mb-4 flex gap-1.5 overflow-hidden">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28 shrink-0" />
        ))}
      </div>
      <div className="mb-3 flex items-center justify-between">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-40" />
      </div>
      <TableSkeleton rows={8} cols={7} />
    </PageBody>
  )
}
