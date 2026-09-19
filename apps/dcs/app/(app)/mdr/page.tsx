// DCS 1b.05: the MDR register — the system's main screen (brief §9.2).
//
// A server component whose ONLY client boundary is the toolbar (1b.06:
// MdrToolbar — saved views, the column picker, Export to Excel). Everything
// that renders a register row is still server-rendered: the filter form is a
// GET form, every sortable heading and every page link is a plain <a>, so a
// filtered, sorted, paged register IS a URL. The DC can bookmark "my
// discipline, awaiting review" and send it to someone — and, since 1b.06, save
// it under that name.
//
// 1b.05 had no client boundary at all and the register worked with JavaScript
// off. It still renders and filters and sorts and pages without it; what needs
// JavaScript is the toolbar, because saving a view is a write and an export is
// bytes. Keeping the table out of the island is what preserves the rest.
//
// Not a guard: which rows appear is decided by "Project members read
// documents" (RLS) reaching through dcs.v_mdr's security_invoker. A user with
// no role on a project sees that project's rows nowhere in this table, and the
// project filter below is SCOPING, not access control — see listMdrPage().
//
// The register is deliberately reachable by every signed-in DCS user. There is
// no page guard because there is nothing to guard: the query returns what the
// caller may read and nothing else, so an outsider gets an empty table rather
// than a redirect.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowDown, ArrowUp, ChevronsUpDown, Search, X } from 'lucide-react'
import { createClient } from '@scl/db/server'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, PageBody, PageHeader, RegisterScroll } from '@/components/page-chrome'
// Deliberately NOT the `Table` primitive: it wraps its <table> in a second
// overflow container, and the frozen band needs exactly one scroller to pin
// against. See RegisterScroll's comment. The rest are plain thead/tr/th/td.
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getActiveDictionary } from '@/lib/dictionaries'
import { getProfileDirectory } from '@/lib/profile-directory'
import {
  MDR_PAGE_SIZE,
  MDR_SORT_COLUMNS,
  columnCount,
  formatMdrDate,
  getMdrProjectOptions,
  hasActiveFilters,
  listMdrPage,
  mdrCellValue,
  mdrFrozenBand,
  mdrHref,
  mdrStatusColor,
  parseMdrSearchParams,
  visibleColumnGroups,
  type MdrColumn,
  type MdrColumnGroup,
  type MdrQuery,
  type MdrRow,
} from '@/lib/mdr'
import { getDefaultUserView, listUserViews, viewToQuery } from '@/lib/user-views'
import MdrToolbar, { PLAIN_HREF, type ToolbarView } from '@/components/MdrToolbar'
import { cn } from '@/lib/utils'

const SORTABLE = new Set<string>(MDR_SORT_COLUMNS)

/** Shared by both header rows; `border-b` is on the cells, see the <table>. */
const GROUP_HEAD = 'border-b text-center text-[11px] font-semibold uppercase tracking-wider'

/**
 * The frozen band and where it sits, resolved against the columns THIS RENDER
 * shows.
 *
 * Per render, not a module constant, and that is the whole point of the merge
 * between the frozen band and the column picker: `groups` is the VISIBLE set,
 * so hiding a column has to narrow the band and recompute the offsets in the
 * same pass. A constant computed from MDR_COLUMN_GROUPS would pin the band
 * against widths belonging to columns that are no longer rendered.
 * mdrFrozenBand() guarantees the band still ends on the SCL number whatever is
 * hidden; this adds where it lands in the header row.
 *
 * DOCUMENT INFO therefore renders as up to three cells: whatever scrolls to
 * the band's left (Process), the band itself, which carries the label because
 * it is the piece always on screen, and the rest of the group. A span of zero
 * is never rendered, so hiding a column cannot leave a colSpan={0} behind.
 */
function frozenLayout(groups: MdrColumnGroup[]) {
  const flat = groups.flatMap((group, groupIndex) =>
    group.columns.map((column, columnIndex) => ({ group, groupIndex, column, columnIndex })),
  )
  const band = new Map(
    mdrFrozenBand(flat.map((entry) => entry.column.key)).map((column) => [column.key, column]),
  )
  const indexes = flat
    .map((entry, index) => (entry.column.key && band.has(entry.column.key) ? index : -1))
    .filter((index) => index >= 0)
  const first = indexes[0] ?? 0
  const last = indexes[indexes.length - 1] ?? -1
  return {
    flat,
    band,
    leading: first,
    span: last - first + 1,
    trailing: (groups[0]?.columns.length ?? 0) - last - 1,
  }
}

type FrozenLayout = ReturnType<typeof frozenLayout>

/**
 * What pins one cell of the frozen band, or nothing for every other column.
 *
 * The offset is an inline style rather than `left-[52px]`, because Tailwind's
 * JIT only emits classes it can read as literals in the source — a class here
 * would mean writing the ladder down a second time, and the second copy is the
 * one that rots.
 */
function frozenCell(layout: FrozenLayout, key: string | null): { className: string; style?: { left: number } } {
  const frozen = key ? layout.band.get(key) : undefined
  if (!frozen) return { className: '' }
  return {
    className: cn('mdr-frozen sticky z-10', frozen.last && 'mdr-frozen-edge border-r border-border'),
    style: { left: frozen.left },
  }
}

/** Holds a frozen column to its declared width, so the offsets stay true. */
function frozenWidth(layout: FrozenLayout, key: string | null, children: React.ReactNode) {
  const frozen = key ? layout.band.get(key) : undefined
  if (!frozen || frozen.contentPx === null) return children
  return (
    <span className="block truncate" style={{ width: frozen.contentPx }}>
      {children}
    </span>
  )
}

export default async function MdrPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = await searchParams
  const query = parseMdrSearchParams(raw)
  const supabase = await createClient()

  // THE DEFAULT VIEW, APPLIED ON ENTRY (1b.06).
  //
  // Only on a BARE /mdr — any parameter at all, including the `view=none` that
  // PLAIN_HREF carries, means the user has said what they want to see and the
  // default must not override it. That rule is also the escape hatch: without
  // it, "Clear filters" would land on /mdr and be bounced straight back into
  // the default view, with no way to reach the plain register at all.
  //
  // The redirect is skipped when the saved view encodes no filters and no
  // column choice, because its href is then /mdr itself and this would be an
  // infinite redirect. A view like that changes nothing anyway.
  if (Object.keys(raw).length === 0) {
    const fallback = await getDefaultUserView(supabase)
    if (fallback) {
      const href = mdrHref(viewToQuery(fallback), {})
      if (href !== '/mdr') redirect(href)
    }
  }

  // ONE query returns the register's rows — filtered, searched, sorted and
  // paged by Postgres (listMdrPage). The other three reads are NOT a second
  // pass over those rows: they fill the filter dropdowns and resolve the three
  // staffing ids to names, because public.profiles RLS ("own row or admin")
  // means the view cannot join the names itself. Nothing below filters, sorts
  // or slices `page.rows` — lib/mdr.test.ts asserts that against a stub client.
  const [page, projects, dictionaries, directory, savedViews] = await Promise.all([
    listMdrPage(supabase, query),
    getMdrProjectOptions(supabase),
    Promise.all([
      getActiveDictionary(supabase, 'doc_type'),
      getActiveDictionary(supabase, 'discipline'),
      getActiveDictionary(supabase, 'workflow_status'),
    ]),
    getProfileDirectory(supabase),
    listUserViews(supabase),
  ])
  const [docTypes, disciplines, statuses] = dictionaries

  // Each saved view as the toolbar needs it: a name and the URL it restores.
  // The href is built here, on the server, by the same viewToQuery + mdrHref
  // pair — so a saved view and a hand-typed URL are the same thing, and the
  // client never has to know how a query is serialised.
  const toolbarViews: ToolbarView[] = savedViews.map((view) => ({
    id: view.id,
    name: view.name,
    isDefault: view.is_default,
    href: mdrHref(viewToQuery(view), {}),
  }))

  // Which saved view, if any, the current URL IS. Compared as canonical hrefs
  // rather than field by field, so "the same register, reached two ways" is
  // one comparison and not five.
  const currentHref = mdrHref({ ...query, page: 1 }, {})
  const activeViewId = toolbarViews.find((view) => view.href === currentHref)?.id ?? null

  // The columns this render shows — the SAME call the export makes, which is
  // what lets the sheet promise "the columns you are looking at".
  const groups = visibleColumnGroups(query.columns)
  const totalColumns = columnCount(groups)
  const layout = frozenLayout(groups)

  const nameById = new Map(directory.entries.map((entry) => [entry.id, entry.full_name]))
  // A colleague outside every shared project is not in the directory (1a.14b
  // narrows it per caller). Show a short id rather than an empty cell, so the
  // column reads as "someone you cannot see" and not as "unstaffed".
  const person = (id: string | null) => (id ? (nameById.get(id) ?? `${id.slice(0, 8)}…`) : '')

  const first = page.total === 0 ? 0 : (page.page - 1) * MDR_PAGE_SIZE + 1
  const last = Math.min(page.page * MDR_PAGE_SIZE, page.total)

  // The three columns rendered as something other than plain text still take
  // their TEXT from mdrCellValue — the same function the .xlsx export uses.
  // That is what makes "the export is what you are looking at" a property of
  // the code rather than a promise kept by hand.
  function cell(row: MdrRow, column: MdrColumn) {
    if (column.key === null) return null

    // The SCL number is the way into the document profile (1b.07's route,
    // standing in as 1b.04's page until then).
    if (column.key === 'scl_doc_number') {
      return (
        <Link
          href={`/documents/${row.document_id}`}
          className="font-mono text-xs underline underline-offset-4"
        >
          {row.scl_doc_number}
        </Link>
      )
    }

    if (column.key === 'workflow_status_code') {
      return (
        <span
          className={cn(
            'inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium',
            mdrStatusColor(row.workflow_status_code),
          )}
        >
          {row.workflow_status_label ?? row.workflow_status_code ?? '—'}
        </span>
      )
    }

    if (column.key === 'issue_date') return formatMdrDate(row.issue_date)
    if (column.key === 'title') return <span className="block max-w-[22rem] truncate">{row.title}</span>

    return mdrCellValue(row, column.key, person)
  }

  return (
    <>
      <PageHeader
        title="MDR"
        description={
          page.total === 0
            ? 'Master Document Register'
            : `Master Document Register — ${page.total} document${page.total === 1 ? '' : 's'}`
        }
      />
      {/* Wider than PageBody's reading width on purpose: the register is a
          spreadsheet, and capping it at max-w-5xl would hide the column groups
          annex C exists to preserve. */}
      <PageBody className="max-w-none">
        {/* The only client component on this screen. It sits ABOVE the filter
            form and outside it on purpose: nesting an island inside a GET form
            would make its buttons submit the form. */}
        <MdrToolbar
          views={toolbarViews}
          query={query}
          activeViewId={activeViewId}
          total={page.total}
        />

        {/* A GET form, so filtering needs no client component and no
            JavaScript: the browser builds the next URL and the server renders
            it. Every control below is named for the searchParam it sets. */}
        <form method="GET" action="/mdr" className="mb-4 flex flex-wrap items-end gap-2">
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
            <span className="text-xs text-muted-foreground">Search</span>
            <span className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                name="q"
                defaultValue={query.search}
                placeholder="SCL number, client number or title"
                className="pl-8"
              />
            </span>
          </label>

          <FilterSelect name="project" label="Project" value={query.projectId}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.project_code ?? project.name}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect name="type" label="Document type" value={query.docTypeId}>
            {docTypes.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} — {row.label}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect name="discipline" label="Discipline" value={query.disciplineId}>
            {disciplines.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} — {row.label}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect name="status" label="Status" value={query.workflowStatusId}>
            {statuses.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </FilterSelect>

          {/* Originator candidates come from the directory, which is already
              loaded for the WORKFLOW columns — no extra read. */}
          <FilterSelect name="orig" label="Originator" value={query.originatorId}>
            {directory.entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.full_name ?? entry.id.slice(0, 8)}
              </option>
            ))}
          </FilterSelect>

          {/* The sort survives a filter change; the page deliberately does not
              (see mdrHref — page 7 of a two-page result looks like a bug). */}
          {query.sort !== 'scl_doc_number' ? <input type="hidden" name="sort" value={query.sort} /> : null}
          {!query.ascending ? <input type="hidden" name="dir" value="desc" /> : null}

          <Button type="submit">Filter</Button>
          {hasActiveFilters(query) ? (
            <Button asChild variant="outline">
              {/* PLAIN_HREF, not "/mdr": a bare /mdr re-applies the default
                  view, so "Clear" would bounce straight back into the filters
                  it just cleared. */}
              <Link href={PLAIN_HREF}>
                <X className="mr-1.5 h-4 w-4" />
                Clear
              </Link>
            </Button>
          ) : null}
        </form>

        {/* An empty register and an empty RESULT are different screens. With
            no filters on there is nothing to keep one's bearings in, so the
            plain empty state is right. With filters on, the table and its
            column groups stay on screen and a single spanning row says why it
            is empty — the DC keeps the layout they were reading across. */}
        {page.rows.length === 0 && !hasActiveFilters(query) ? (
          <EmptyState title="The register is empty">
            Documents appear here as soon as they are created, with the SCL number the system assigns them.
          </EmptyState>
        ) : (
          <RegisterScroll>
            {/* border-separate, not the preflight default: with collapsed
                borders a cell's borders are painted by the TABLE, so a sticky
                cell travels and leaves its borders behind. Separated borders
                belong to the cell, which is why every th/td below carries its
                own `border-b` instead of the row carrying one. */}
            <table className="w-full min-w-[44rem] caption-bottom border-separate border-spacing-0 text-sm">
              <TableHeader>
                {/* Two header rows that have to agree — both derived from
                    `groups` so they cannot drift apart — and `groups` is
                    the visible set, so hiding a column narrows the band above
                    it in the same render. */}
                <TableRow className="hover:bg-transparent">
                  {/* DOCUMENT INFO is the one group the frozen band cuts
                      through — see frozenLayout(). The band's cell pins at
                      left 0, the same place the band's first column does,
                      which is what keeps the two header rows aligned at every
                      scroll position, whatever the column picker has hidden. */}
                  {layout.leading > 0 ? <TableHead colSpan={layout.leading} className={GROUP_HEAD} /> : null}
                  <TableHead
                    colSpan={layout.span}
                    className={cn(GROUP_HEAD, 'mdr-frozen mdr-frozen-edge sticky left-0 z-20 border-r border-border')}
                  >
                    {groups[0].label}
                  </TableHead>
                  {layout.trailing > 0 ? <TableHead colSpan={layout.trailing} className={GROUP_HEAD} /> : null}
                  {groups.slice(1).map((group) => (
                    <TableHead
                      key={group.label}
                      colSpan={group.columns.length}
                      className={cn(GROUP_HEAD, 'border-l border-border/60')}
                    >
                      {group.label}
                    </TableHead>
                  ))}
                </TableRow>
                <TableRow className="hover:bg-transparent">
                  {layout.flat.map(({ group, groupIndex, column, columnIndex }) => {
                    const frozen = frozenCell(layout, column.key)
                    return (
                      <TableHead
                        key={`${group.label}-${column.label}`}
                        className={cn(
                          'whitespace-nowrap border-b text-xs',
                          columnIndex === 0 && groupIndex > 0 && 'border-l border-border/60',
                          column.numeric && 'text-right',
                          frozen.className,
                        )}
                        style={frozen.style}
                      >
                        {frozenWidth(
                          layout,
                          column.key,
                          column.key && SORTABLE.has(column.key) ? (
                            <SortLink query={query} column={column.key} label={column.label} />
                          ) : (
                            column.label
                          ),
                        )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={totalColumns} className="py-10 text-center text-sm text-muted-foreground">
                      No documents match these filters. <Link href={PLAIN_HREF} className="underline underline-offset-4">Clear them</Link> to see the whole register.
                    </TableCell>
                  </TableRow>
                ) : null}
                {page.rows.map((row, rowIndex) => (
                  <TableRow key={row.document_id}>
                    {layout.flat.map(({ group, groupIndex, column, columnIndex }) => {
                      const frozen = frozenCell(layout, column.key)
                      return (
                        <TableCell
                          key={`${group.label}-${column.label}`}
                          className={cn(
                            'whitespace-nowrap text-xs',
                            rowIndex < page.rows.length - 1 && 'border-b',
                            columnIndex === 0 && groupIndex > 0 && 'border-l border-border/60',
                            column.numeric && 'text-right tabular-nums',
                            frozen.className,
                          )}
                          style={frozen.style}
                        >
                          {frozenWidth(layout, column.key, cell(row, column))}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </RegisterScroll>
        )}

        {page.pageCount > 1 ? (
          <nav className="mt-4 flex items-center justify-between gap-3 text-sm" aria-label="Register pages">
            <span className="text-muted-foreground">
              {first}–{last} of {page.total}
            </span>
            <span className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm" disabled={page.page <= 1}>
                <Link href={mdrHref(query, { page: page.page - 1 })} aria-disabled={page.page <= 1}>
                  Previous
                </Link>
              </Button>
              <span className="text-muted-foreground">
                Page {page.page} of {page.pageCount}
              </span>
              <Button asChild variant="outline" size="sm" disabled={page.page >= page.pageCount}>
                <Link
                  href={mdrHref(query, { page: page.page + 1 })}
                  aria-disabled={page.page >= page.pageCount}
                >
                  Next
                </Link>
              </Button>
            </span>
          </nav>
        ) : null}

        <p className="mt-6 text-xs text-muted-foreground">
          {/* Said on the screen, not only in a migration comment, because the
              first question at the demo will be why two thirds of the columns
              are blank. */}
          The four stage groups (IDC / IFR / RETCOM / IFC-IFI) and WORKFLOW ·
          Type are part of the register&rsquo;s layout but have no data yet:
          planned and forecast dates arrive with the scheduling phase. Status
          colours are provisional pending the colour mapping agreed with the
          Document Controller.
        </p>
      </PageBody>
    </>
  )
}

/** One filter dropdown. "All" is the empty value, which parseMdrSearchParams reads as no filter. */
function FilterSelect({
  name,
  label,
  value,
  children,
}: {
  name: string
  label: string
  value: string | null
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <select
        name={name}
        defaultValue={value ?? ''}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">All</option>
        {children}
      </select>
    </label>
  )
}

/** A sortable column heading: a link that flips direction when it is the active sort. */
function SortLink({ query, column, label }: { query: MdrQuery; column: string; label: string }) {
  const active = query.sort === column
  const Icon = active ? (query.ascending ? ArrowUp : ArrowDown) : ChevronsUpDown
  return (
    <Link
      href={mdrHref(query, {
        sort: column as MdrQuery['sort'],
        // Clicking the active column flips it; a new column starts ascending.
        ascending: active ? !query.ascending : true,
      })}
      className={cn(
        'inline-flex items-center gap-1 hover:text-foreground',
        active ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {label}
      <Icon className="h-3 w-3 shrink-0" />
    </Link>
  )
}
