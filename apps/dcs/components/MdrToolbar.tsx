'use client'

// DCS 1b.06: the register's toolbar — saved views, the column picker, and
// "Export to Excel".
//
// THE ONE CLIENT BOUNDARY ON /mdr, AND WHY IT IS HERE AT ALL.
// 1b.05 built the register with no client component anywhere: every control is
// a link or a GET form, a filtered register IS a URL, and the whole screen
// works with JavaScript disabled. That property is worth keeping, so this
// component is an ISLAND — the filter form, the table, its headers and paging
// are untouched server-rendered markup. Nothing below renders a register row.
//
// The three things here genuinely cannot be links:
//   * saving, renaming, deleting and defaulting a view are writes;
//   * the export has to receive bytes and hand them to the browser;
//   * the column picker composes a `cols=` value from many checkboxes before
//     navigating once, which a GET form of 35 checkboxes would do by putting
//     all 35 names in the URL.
// Restoring a view, by contrast, is nothing but navigation: the dropdown
// pushes the URL the saved filters and columns encode, and the server renders
// it like any other register URL — so a restored view is still a URL the DC
// can bookmark and send to someone. Nothing about a saved view is client
// state.
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Download, Loader2, Star, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SELECT_CLASS } from '@/components/AddMemberForm'
import { Callout } from '@/components/page-chrome'
import { SKIPPED, usePendingAction } from '@/hooks/use-pending-action'
import { exportMdrToExcel } from '@/app/data/actions/mdr-export'
import {
  deleteMdrView,
  renameMdrView,
  saveMdrView,
  setDefaultMdrView,
} from '@/app/data/actions/user-views'
import { MDR_COLUMN_GROUPS, MDR_REQUIRED_COLUMN_KEY, mdrHref, type MdrQuery } from '@/lib/mdr'
import { cn } from '@/lib/utils'

/**
 * The URL that means "the register, with no default view applied".
 *
 * /mdr with no parameters at all is where the default view is applied (see
 * MdrPage), so every control that means "show me the plain register" has to
 * carry something. `view=none` is ignored by parseMdrSearchParams — its only
 * job is to be a parameter, which is what suppresses the redirect.
 */
export const PLAIN_HREF = '/mdr?view=none'

/** Only what the toolbar needs — not the whole row, so the payload stays small. */
export type ToolbarView = {
  id: string
  name: string
  isDefault: boolean
  /** Where restoring this view goes. Built on the server by viewToQuery + mdrHref. */
  href: string
}

type Props = {
  views: ToolbarView[]
  /** The register's current state, already parsed — what "save current view" saves. */
  query: MdrQuery
  /** The id of the view currently restored, if the URL matches one. */
  activeViewId: string | null
  /** Rows matching the active filters, for the export button's label. */
  total: number
}

export default function MdrToolbar({ views, query, activeViewId, total }: Props) {
  const router = useRouter()
  const { run, refresh, pending } = usePendingAction()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<ToolbarView | null>(null)

  const active = views.find((view) => view.id === activeViewId) ?? null

  // The search params the export and "save view" send back to the server. Built
  // from mdrHref so it is exactly the URL the screen would render — one
  // serialiser, not two. page is dropped: the export is the whole result and a
  // saved view is not a position.
  const params = useMemo(() => {
    const qs = mdrHref({ ...query, page: 1 }, {}).split('?')[1] ?? ''
    return Object.fromEntries(new URLSearchParams(qs))
  }, [query])

  function report(result: { ok: true } | { ok: false; error: string }, ok: string) {
    if (result.ok) {
      setError(null)
      setNotice(ok)
      refresh()
    } else {
      setNotice(null)
      setError(result.error)
    }
  }

  async function onExport() {
    setError(null)
    setNotice(null)
    const result = await run(() => exportMdrToExcel(params))
    if (result === SKIPPED) return
    if (!result.ok) {
      setError(result.error)
      return
    }

    // base64 -> Blob -> a click on an object URL. The download has to be
    // started by this click: a browser blocks one that arrives later, which is
    // the reason the bytes come back from the action rather than being fetched
    // afterwards.
    const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0))
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = result.filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // Revoked on the next tick, not immediately: revoking synchronously after
    // click() races the browser's read of the URL in some engines.
    setTimeout(() => URL.revokeObjectURL(url), 0)

    setNotice(
      result.truncated
        ? `Exported the first ${result.rowCount} rows — the filter matched more than one export carries. Narrow it and export again.`
        : `Exported ${result.rowCount} ${result.rowCount === 1 ? 'row' : 'rows'} to ${result.filename}`,
    )
  }

  async function onSave() {
    const result = await run(() => saveMdrView(name, params))
    if (result === SKIPPED) return
    if (result.ok) {
      setSaveOpen(false)
      setName('')
    }
    report(result, `Saved "${name.trim()}".`)
  }

  async function onRename() {
    if (!renaming) return
    const result = await run(() => renameMdrView(renaming.id, name))
    if (result === SKIPPED) return
    if (result.ok) {
      setRenaming(null)
      setName('')
    }
    report(result, 'View renamed.')
  }

  async function onDelete(view: ToolbarView) {
    const result = await run(() => deleteMdrView(view.id))
    if (result === SKIPPED) return
    report(result, `Deleted "${view.name}".`)
    // Leaving the user on the URL of a view that no longer exists is harmless
    // — it is just a filtered register — so the page is not navigated away.
  }

  async function onDefault(view: ToolbarView) {
    // Clicking the star on the current default clears it: otherwise a user who
    // sets one has no way back to opening the register plain.
    const next = view.isDefault ? null : view.id
    const result = await run(() => setDefaultMdrView(next))
    if (result === SKIPPED) return
    report(result, next === null ? 'Default view cleared.' : `"${view.name}" opens the register by default.`)
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {/* --- My views ---------------------------------------------------- */}
      <label className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">My views</span>
        <select
          className={cn(SELECT_CLASS, 'min-w-[12rem]')}
          value={activeViewId ?? ''}
          disabled={pending}
          onChange={(event) => {
            const view = views.find((candidate) => candidate.id === event.target.value)
            // Restoring is navigation, nothing more — the saved filters and
            // columns ARE the URL they encode.
            // PLAIN_HREF, not '/mdr': a bare /mdr re-applies the default
            // view, so choosing "Unsaved view" would bounce straight back
            // to the one the user was trying to step out of.
            router.push(view ? view.href : PLAIN_HREF)
          }}
        >
          <option value="">{views.length === 0 ? 'No saved views' : 'Unsaved view'}</option>
          {views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.isDefault ? `★ ${view.name}` : view.name}
            </option>
          ))}
        </select>
      </label>

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          setName(active?.name ?? '')
          setSaveOpen(true)
        }}
      >
        Save current view
      </Button>

      {active ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              setName(active.name)
              setRenaming(active)
            }}
          >
            Rename
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            title={active.isDefault ? 'Stop opening the register on this view' : 'Open the register on this view'}
            onClick={() => onDefault(active)}
          >
            <Star className={cn('mr-1.5 h-4 w-4', active.isDefault && 'fill-current')} />
            {active.isDefault ? 'Default' : 'Make default'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => onDelete(active)}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Delete
          </Button>
        </>
      ) : null}

      {/* --- Columns ------------------------------------------------------ */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => setColumnsOpen(true)}
      >
        Columns
        {query.columns.length > 0 ? (
          <span className="ml-1.5 rounded bg-muted px-1.5 text-xs">{query.columns.length}</span>
        ) : null}
      </Button>

      {/* --- Export ------------------------------------------------------- */}
      <Button type="button" size="sm" disabled={pending} onClick={onExport} className="ml-auto">
        {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
        {/* The label says "all N", not "this page": the sheet is the whole
            filtered result, and a user who expected 50 rows and got 146 should
            have been told before clicking, not after opening the file. */}
        Export to Excel{total > 0 ? ` (all ${total})` : ''}
      </Button>

      {error ? (
        <div className="w-full">
          <Callout tone="error">{error}</Callout>
        </div>
      ) : null}
      {notice && !error ? (
        <div className="w-full">
          <Callout tone="info">{notice}</Callout>
        </div>
      ) : null}

      <NameDialog
        open={saveOpen}
        title="Save current view"
        description="Stores the filters, the sort and the visible columns under a name. Saving over an existing name replaces it."
        name={name}
        pending={pending}
        onName={setName}
        onCancel={() => setSaveOpen(false)}
        onConfirm={onSave}
      />
      <NameDialog
        open={renaming !== null}
        title="Rename view"
        description="The filters and columns stay as they are."
        name={name}
        pending={pending}
        onName={setName}
        onCancel={() => setRenaming(null)}
        onConfirm={onRename}
      />
      <ColumnsDialog
        open={columnsOpen}
        query={query}
        onClose={() => setColumnsOpen(false)}
        onApply={(columns) => {
          setColumnsOpen(false)
          router.push(mdrHref(query, { columns }))
        }}
      />
    </div>
  )
}

/** Save and Rename ask the same question, so they are the same dialog. */
function NameDialog({
  open,
  title,
  description,
  name,
  pending,
  onName,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  description: string
  name: string
  pending: boolean
  onName: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onCancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="mdr-view-name">Name</Label>
          <Input
            id="mdr-view-name"
            value={name}
            maxLength={120}
            autoFocus
            placeholder="My discipline, awaiting review"
            onChange={(event) => onName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && name.trim() && !pending) onConfirm()
            }}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={pending || name.trim().length === 0}>
            {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The column picker, grouped exactly as annex C groups the register.
 *
 * Local state until Apply, then ONE navigation: a checkbox that navigated on
 * every click would make hiding six columns six server renders of a 35-column
 * table.
 */
function ColumnsDialog({
  open,
  query,
  onClose,
  onApply,
}: {
  open: boolean
  query: MdrQuery
  onClose: () => void
  onApply: (columns: string[]) => void
}) {
  // Empty selection means every column, so the dialog opens with everything
  // ticked — that is what the user is looking at.
  const [chosen, setChosen] = useState<string[]>(query.columns)
  const all = useMemo(
    () => MDR_COLUMN_GROUPS.flatMap((group) => group.columns.map((column) => column.key)).filter(Boolean) as string[],
    [],
  )
  const selected = chosen.length === 0 ? all : chosen

  function toggle(key: string) {
    setChosen(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key])
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
        // Re-sync on every open: the user may have navigated since.
        else setChosen(query.columns)
      }}
    >
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Columns</DialogTitle>
          <DialogDescription>
            Choose what the register shows. The export follows this exactly. The SCL number always
            stays — it is what identifies the document.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          {MDR_COLUMN_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <ul className="space-y-1">
                {group.columns.map((column) => {
                  const key = column.key
                  if (!key) return null
                  const required = key === MDR_REQUIRED_COLUMN_KEY
                  const on = selected.includes(key)
                  return (
                    <li key={key}>
                      <label
                        className={cn(
                          'flex items-center gap-2 text-sm',
                          required && 'text-muted-foreground',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={on || required}
                          disabled={required}
                          onChange={() => toggle(key)}
                          className="h-3.5 w-3.5"
                        />
                        {column.label}
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" onClick={() => setChosen([])}>
            Show every column
          </Button>
          <span className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() =>
                // An explicit "all" is stored as empty, not as 35 keys — see
                // normaliseColumnSelection. Same value, and it survives a
                // column being added to the register later.
                onApply(selected.length === all.length ? [] : selected)
              }
            >
              <Check className="mr-1.5 h-4 w-4" />
              Apply
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
