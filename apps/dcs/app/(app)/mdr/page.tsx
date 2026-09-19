// DCS 1b.05: the MDR register — the system's main screen (brief §9.2).
//
// A server component with NO client boundary anywhere in it. Every control is
// a plain link or a GET form, so the whole register works with JavaScript
// disabled, and — the part that matters day to day — a filtered, sorted,
// paged register IS a URL. The DC can bookmark "my discipline, awaiting
// review" and send it to someone.
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
  MDR_COLUMN_COUNT,
  MDR_COLUMN_GROUPS,
  MDR_PAGE_SIZE,
  MDR_SORT_COLUMNS,
  getMdrProjectOptions,
  hasActiveFilters,
  listMdrPage,
  mdrFrozenBand,
  mdrHref,
  mdrStatusColor,
  parseMdrSearchParams,
  type MdrColumn,
  type MdrQuery,
  type MdrRow,
} from '@/lib/mdr'
import { cn } from '@/lib/utils'

const SORTABLE = new Set<string>(MDR_SORT_COLUMNS)

/**
 * Every column with its position in the WHOLE register, not in its group.
 * The frozen band is defined by that global index, and a per-group index
 * cannot express it: the band is the first five of DOCUMENT INFO's eleven.
 */
const FLAT_COLUMNS = MDR_COLUMN_GROUPS.flatMap((group, groupIndex) =>
  group.columns.map((column, columnIndex) => ({ group, groupIndex, column, columnIndex })),
)

/** Shared by both header rows; `border-b` is on the cells, see the <table>. */
const GROUP_HEAD = 'border-b text-center text-[11px] font-semibold uppercase tracking-wider'

/**
 * The frozen band, resolved against the columns this screen renders.
 *
 * Every column is visible today, so this is the whole band; it is written as a
 * resolution rather than a constant because 1b.06's column picker will hand it
 * a narrower list, and the offsets have to be the running total of what is
 * ACTUALLY rendered. See mdrFrozenBand().
 */
const FROZEN = new Map(
  mdrFrozenBand(FLAT_COLUMNS.map((entry) => entry.column.key)).map((column) => [column.key, column]),
)

/**
 * Where the band sits in the header row — derived, so the group header cannot
 * come apart from the columns it is supposed to sit over.
 *
 * DOCUMENT INFO therefore renders as up to three cells: whatever scrolls to
 * the band's left (Process), the band itself, which carries the label because
 * it is the piece always on screen, and the rest of the group. A span of zero
 * is not rendered at all, so dropping a column from the band cannot leave a
 * colSpan={0} behind.
 */
const FROZEN_INDEXES = FLAT_COLUMNS.map((entry, index) =>
  entry.column.key && FROZEN.has(entry.column.key) ? index : -1,
).filter((index) => index >= 0)
const BAND_FIRST = FROZEN_INDEXES[0] ?? 0
const BAND_LAST = FROZEN_INDEXES[FROZEN_INDEXES.length - 1] ?? -1
const BAND_LEADING = BAND_FIRST
const BAND_SPAN = BAND_LAST - BAND_FIRST + 1
const BAND_TRAILING = MDR_COLUMN_GROUPS[0].columns.length - BAND_LAST - 1

/**
 * What pins one cell of the frozen band, or nothing for every other column.
 *
 * The offset is an inline style rather than `left-[52px]`, because Tailwind's
 * JIT only emits classes it can read as literals in the source — a class here
 * would mean writing the ladder down a second time, and the second copy is the
 * one that rots.
 */
function frozenCell(key: string | null): { className: string; style?: { left: number } } {
  const frozen = key ? FROZEN.get(key) : undefined
  if (!frozen) return { className: '' }
  return {
    className: cn('mdr-frozen sticky z-10', frozen.last && 'mdr-frozen-edge border-r border-border'),
    style: { left: frozen.left },
  }
}

/** Holds a frozen column to its declared width, so the offsets stay true. */
function frozenWidth(key: string | null, children: React.ReactNode) {
  const frozen = key ? FROZEN.get(key) : undefined
  if (!frozen || frozen.contentPx === null) return children
  return (
    <span className="block truncate" style={{ width: frozen.contentPx }}>
      {children}
    </span>
  )
}

/** dd.MM.yyyy — the format the sheet uses; the register is read, not parsed. */
function formatDate(value: string | null): string {
  if (!value) return ''
  const [y, m, d] = value.split('-')
  return y && m && d ? `${d}.${m}.${y}` : value
}

export default async function MdrPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = parseMdrSearchParams(await searchParams)
  const supabase = await createClient()

  // ONE query returns the register's rows — filtered, searched, sorted and
  // paged by Postgres (listMdrPage). The other three reads are NOT a second
  // pass over those rows: they fill the filter dropdowns and resolve the three
  // staffing ids to names, because public.profiles RLS ("own row or admin")
  // means the view cannot join the names itself. Nothing below filters, sorts
  // or slices `page.rows` — lib/mdr.test.ts asserts that against a stub client.
  const [page, projects, dictionaries, directory] = await Promise.all([
    listMdrPage(supabase, query),
    getMdrProjectOptions(supabase),
    Promise.all([
      getActiveDictionary(supabase, 'doc_type'),
      getActiveDictionary(supabase, 'discipline'),
      getActiveDictionary(supabase, 'workflow_status'),
    ]),
    getProfileDirectory(supabase),
  ])
  const [docTypes, disciplines, statuses] = dictionaries

  const nameById = new Map(directory.entries.map((entry) => [entry.id, entry.full_name]))
  // A colleague outside every shared project is not in the directory (1a.14b
  // narrows it per caller). Show a short id rather than an empty cell, so the
  // column reads as "someone you cannot see" and not as "unstaffed".
  const person = (id: string | null) => (id ? (nameById.get(id) ?? `${id.slice(0, 8)}…`) : '')

  const first = page.total === 0 ? 0 : (page.page - 1) * MDR_PAGE_SIZE + 1
  const last = Math.min(page.page * MDR_PAGE_SIZE, page.total)

  function cell(row: MdrRow, column: MdrColumn) {
    if (column.key === null) return null
    const value = row[column.key]

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

    if (column.key === 'originator_id') return person(row.originator_id)
    if (column.key === 'checker_id') return person(row.checker_id)
    if (column.key === 'approver_id') return person(row.approver_id)

    if (column.key === 'issue_date') return formatDate(row.issue_date)
    if (column.key === 'title') return <span className="block max-w-[22rem] truncate">{row.title}</span>

    return value === null || value === undefined ? '' : String(value)
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
              <Link href="/mdr">
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
                    MDR_COLUMN_GROUPS so they cannot drift apart. */}
                <TableRow className="hover:bg-transparent">
                  {/* DOCUMENT INFO is the one group the frozen band cuts
                      through — see BAND_LEADING above. The band's cell pins at
                      left 0, the same place the band's first column does,
                      which is what keeps the two header rows aligned at every
                      scroll position. */}
                  {BAND_LEADING > 0 ? <TableHead colSpan={BAND_LEADING} className={GROUP_HEAD} /> : null}
                  <TableHead
                    colSpan={BAND_SPAN}
                    className={cn(GROUP_HEAD, 'mdr-frozen mdr-frozen-edge sticky left-0 z-20 border-r border-border')}
                  >
                    {MDR_COLUMN_GROUPS[0].label}
                  </TableHead>
                  {BAND_TRAILING > 0 ? <TableHead colSpan={BAND_TRAILING} className={GROUP_HEAD} /> : null}
                  {MDR_COLUMN_GROUPS.slice(1).map((group) => (
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
                  {FLAT_COLUMNS.map(({ group, groupIndex, column, columnIndex }) => {
                    const frozen = frozenCell(column.key)
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
                    <TableCell colSpan={MDR_COLUMN_COUNT} className="py-10 text-center text-sm text-muted-foreground">
                      No documents match these filters. <Link href="/mdr" className="underline underline-offset-4">Clear them</Link> to see the whole register.
                    </TableCell>
                  </TableRow>
                ) : null}
                {page.rows.map((row, rowIndex) => (
                  <TableRow key={row.document_id}>
                    {FLAT_COLUMNS.map(({ group, groupIndex, column, columnIndex }) => {
                      const frozen = frozenCell(column.key)
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
                          {frozenWidth(column.key, cell(row, column))}
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
