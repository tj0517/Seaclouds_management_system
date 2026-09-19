// DCS 1a.24: the pieces every DCS screen repeats — a page header, a scroll
// container for wide tables, one shape for empty states and one for the
// inline messages the screens already showed (read-only notices, degraded
// reads, "no DC assigned"). Before this, each screen hand-rolled its own
// spacing and its own red/amber/grey box, so the same idea looked different
// on four screens.
//
// Server components, no client boundary: they are markup, and being usable
// from a loading.tsx matters.
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/** Caps the reading width without hard-coding a max-width on every screen. */
export function PageBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('mx-auto w-full max-w-5xl', className)}>{children}</div>
}

/**
 * The only place a table is allowed to be wider than the viewport. The
 * overflow lives here, never on <main> — that was the old bug: <main
 * overflow-auto> reported no page scroll while clipping the table away.
 */
export function ScrollableTable({ children }: { children: ReactNode }) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border bg-card">
      <div className="min-w-[44rem]">{children}</div>
    </div>
  )
}

/**
 * The MDR register's scroll container — ONE scroller, which ScrollableTable
 * above is not.
 *
 * WHY THIS EXISTS RATHER THAN A PROP ON ScrollableTable. The register freezes
 * its first five columns, and `position: sticky` resolves against the nearest
 * scrolling ancestor — so "which element scrolls" stops being an
 * implementation detail and becomes the thing the feature rests on. Measured
 * in a browser on 2026-09-19, the register had TWO nested horizontal
 * scrollers:
 *
 *   - ScrollableTable's own `overflow-x-auto`, which at 1440px never fires
 *     (its child never outgrows it) but at 1024px does — 704px of content in
 *     702px — and at 900px scrolls 126px;
 *   - the div inside the shadcn `Table` primitive (components/ui/table.tsx,
 *     `relative w-full overflow-auto`), which is the one actually carrying
 *     the register's 2634px of columns.
 *
 * A column pinned to the inner one still slides away when the OUTER one
 * scrolls, so below ~1030px a sticky column would come unstuck — silently,
 * and only at the widths nobody screenshots. The register therefore renders a
 * bare <table> inside this container and skips the `Table` primitive
 * altogether (TableHeader/TableRow/TableCell are plain thead/tr/td and are
 * still used); components/ui/table.tsx is untouched, which CLAUDE.md requires,
 * and the four other screens keep ScrollableTable exactly as it was.
 *
 * The border and the rounded corners sit on the scroller itself, not on a
 * wrapper around it, so the frozen band's edge lines up with the container's.
 * `mdr-scroll` is defined in app/globals.css and does two things a Tailwind
 * class cannot: it styles the scrollbar, and by styling it at all it opts the
 * element out of the platform's OVERLAY scrollbar, which is what was painting
 * the bar across the last row.
 */
export function RegisterScroll({ children }: { children: ReactNode }) {
  return <div className="mdr-scroll w-full overflow-x-auto rounded-lg border bg-card">{children}</div>
}

const CALLOUT_TONES = {
  info: 'border-border bg-muted text-muted-foreground',
  warning: 'border-warning/25 bg-warning-bg text-warning',
  error: 'border-destructive/25 bg-destructive/10 text-destructive',
} as const

export function Callout({
  tone = 'info',
  children,
}: {
  tone?: keyof typeof CALLOUT_TONES
  children: ReactNode
}) {
  return (
    <div className={cn('mb-4 rounded-lg border px-3 py-2.5 text-sm', CALLOUT_TONES[tone])}>{children}</div>
  )
}

export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed bg-card px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</p> : null}
    </div>
  )
}
