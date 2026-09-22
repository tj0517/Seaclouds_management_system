// DCS 1b.07 / 1b.08 / 1b.09: the actions of the current-revision panel.
//
// New Revision is live since DCS 1b.08 and Add File since DCS 1b.09 — each a
// dialog for the readers the database lets write, and a disabled button that
// says why for everyone else (a Void document, a viewer, a DC without the
// second factor, a document with no revision yet). The other four stay
// disabled, each naming the phase that turns it on.
//
// The hint is shown twice on purpose. `title` sits on a wrapper span, not on
// the button, because a disabled <button> receives no pointer events in some
// browsers and never shows its own title; the same sentence is also printed
// under the button and tied to it with aria-describedby, because a hover-only
// tooltip is invisible on touch and to keyboard users. (A Radix Tooltip would
// fix both but is a new dependency — the decision recorded on the 1b.07 PR.)
import { Button } from '@/components/ui/button'
import { PANEL_ACTIONS } from '@/lib/document-profile'
import type { FileUploadAccess } from '@/lib/files'
import type { LockRevisionAccess, NewRevisionAccess } from '@/lib/revisions'
import AddFileDialog from './AddFileDialog'
import ApproveRevisionButton from './ApproveRevisionButton'
import NewRevisionDialog, { type NewRevisionFormConfig } from './NewRevisionDialog'

export type NewRevisionControl = { access: NewRevisionAccess; config: NewRevisionFormConfig }
/** config is null when the document has no current revision (access is then 'no_revision'). */
export type AddFileControl = {
  access: FileUploadAccess
  config: { revisionId: string; revisionLabel: string; documentNumber: string } | null
}
/** config is null when the document has no current revision (access is then 'not_final_step'). */
export type ApproveControl = {
  access: LockRevisionAccess
  config: { documentId: string; revisionId: string; revisionLabel: string } | null
}

export default function RevisionPanelActions({
  newRevision,
  addFile,
  approve,
}: {
  newRevision: NewRevisionControl
  addFile: AddFileControl
  approve: ApproveControl
}) {
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
      <li className="space-y-1">
        {addFile.access.mode === 'enabled' && addFile.config ? (
          <AddFileDialog variant="panel" {...addFile.config} />
        ) : (
          <>
            <span title={addFile.access.mode === 'disabled' ? addFile.access.hint : undefined} className="block">
              <Button type="button" disabled className="w-full" aria-describedby="panel-action-add-file-hint">
                Add File
              </Button>
            </span>
            <p id="panel-action-add-file-hint" className="text-xs text-muted-foreground">
              {addFile.access.mode === 'disabled' ? addFile.access.hint : ''}
            </p>
          </>
        )}
      </li>
      <li className="space-y-1">
        {approve.access.mode === 'enabled' && approve.config ? (
          <ApproveRevisionButton documentId={approve.config.documentId} revisionId={approve.config.revisionId} revisionLabel={approve.config.revisionLabel} />
        ) : (
          <>
            <span title={approve.access.mode === 'disabled' ? approve.access.hint : undefined} className="block">
              <Button type="button" disabled variant="outline" className="w-full" aria-describedby="panel-action-approve-hint">
                Approve
              </Button>
            </span>
            <p id="panel-action-approve-hint" className="text-xs text-muted-foreground">
              {approve.access.mode === 'disabled' ? approve.access.hint : ''}
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
