// Enable DCS (DCS-1b.24): header, the five-step strip, then the step-1 fields.
import { Skeleton } from '@/components/ui/skeleton'
import { PageBody } from '@/components/page-chrome'
import { HeaderSkeleton } from '@/components/skeletons'

export default function Loading() {
  return (
    <PageBody className="max-w-3xl">
      <HeaderSkeleton action />
      <div className="rounded-lg border bg-card p-5">
        <div className="mb-6 flex flex-wrap gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-24" />
          ))}
        </div>
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
        <div className="mt-6 flex justify-between border-t pt-4">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>
    </PageBody>
  )
}
