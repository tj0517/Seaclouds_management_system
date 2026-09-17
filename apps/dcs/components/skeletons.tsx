// DCS 1a.24: the shapes a route shows while its server render is in flight.
//
// These exist because measurement said they had to: a navigation on scl-dev
// takes 400-470ms, and until this task nothing at all happened on screen
// during it (there was no loading.tsx anywhere in apps/dcs). A skeleton is
// the first frame after the click.
//
// They are deliberately shaped like the page they stand in for — same header,
// same column count, same row height — so the layout does not jump when the
// real content arrives. Server components: a loading.tsx needs no client JS.
import { Skeleton } from '@/components/ui/skeleton'
import { PageBody } from '@/components/page-chrome'

function HeaderSkeleton({ action = false }: { action?: boolean }) {
  return (
    <header className="mb-6 flex items-start justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {action ? <Skeleton className="h-9 w-36 shrink-0" /> : null}
    </header>
  )
}

/** A bordered table with `rows` rows of `cols` cells. */
export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex gap-4 border-b bg-muted/50 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b px-4 py-4 last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function ListPageSkeleton({
  action = false,
  rows = 5,
  cols = 5,
  className,
}: {
  action?: boolean
  rows?: number
  cols?: number
  className?: string
}) {
  return (
    <PageBody className={className}>
      <HeaderSkeleton action={action} />
      <TableSkeleton rows={rows} cols={cols} />
    </PageBody>
  )
}

/** Header + a row of stat tiles + stacked cards — the project/user shape. */
export function DetailPageSkeleton({ tiles = 0, cards = 3 }: { tiles?: number; cards?: number }) {
  return (
    <PageBody className="max-w-4xl">
      <HeaderSkeleton action />
      {tiles > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border bg-card p-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: tiles }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      )}
      <div className="space-y-3">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-4">
            <Skeleton className="mb-3 h-4 w-40" />
            <div className="flex flex-wrap gap-4">
              {Array.from({ length: 6 }).map((_, j) => (
                <Skeleton key={j} className="h-4 w-24" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </PageBody>
  )
}

export { HeaderSkeleton }
