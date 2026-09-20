// DCS 1b.07 / 1b.08: the actions of the current-revision panel.
//
// New Revision is live since DCS 1b.08 — a dialog for the readers the database
// lets create one, and a disabled button that says why for everyone else (a Void
// document, a viewer, a DC without the second factor). The other five stay
// disabled, each naming the task or phase that turns it on; nothing here writes
// to dcs.files (1b.09 owns files, and "Add File" says so).
//
// The hint is shown twice on purpose. `title` sits on a wrapper span, not on
// the button, because a disabled <button> receives no pointer events in some
// browsers and never shows its own title; the same sentence is also printed
// under the button and tied to it with aria-describedby, because a hover-only
// tooltip is invisible on touch and to keyboard users. (A Radix Tooltip would
// fix both but is a new dependency — the decision recorded on the 1b.07 PR.)
import { Button } from '@/components/ui/button'
import { PANEL_ACTIONS } from '@/lib/document-profile'
import type { NewRevisionAccess } from '@/lib/revisions'
import NewRevisionDialog, { type NewRevisionFormConfig } from './NewRevisionDialog'

export type NewRevisionControl = { access: NewRevisionAccess; config: NewRevisionFormConfig }

export default function RevisionPanelActions({ newRevision }: { newRevision: NewRevisionControl }) {
  const { access, config } = newRevision
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
      <li className="space-y-1">
        {access.mode === 'enabled' ? (
          <NewRevisionDialog config={config} />
        ) : (
          <>
            <span title={access.hint} className="block">
              <Button type="button" disabled className="w-full" aria-describedby="panel-action-new-revision-hint">
                New Revision
              </Button>
            </span>
            <p id="panel-action-new-revision-hint" className="text-xs text-muted-foreground">
              {access.hint}
            </p>
          </>
        )}
      </li>
      {PANEL_ACTIONS.map((action) => {
        const captionId = `panel-action-${action.key}-hint`
        return (
          <li key={action.key} className="space-y-1">
            <span title={action.hint} className="block">
              <Button type="button" disabled variant="outline" className="w-full" aria-describedby={captionId}>
                {action.label}
              </Button>
            </span>
            <p id={captionId} className="text-xs text-muted-foreground">
              {action.hint}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
