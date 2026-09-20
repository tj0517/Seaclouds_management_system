// DCS 1b.07: the actions of the current-revision panel — all present, all
// disabled. Nothing here writes to dcs.revisions or dcs.files (acceptance 6);
// each button says which task or phase turns it on.
//
// The hint is shown twice on purpose. `title` sits on a wrapper span, not on
// the button, because a disabled <button> receives no pointer events in some
// browsers and never shows its own title; the same sentence is also printed
// under the button and tied to it with aria-describedby, because a hover-only
// tooltip is invisible on touch and to keyboard users. (A Radix Tooltip would
// fix both but is a new dependency — the decision recorded on this PR.)
import { Button } from '@/components/ui/button'
import { PANEL_ACTIONS } from '@/lib/document-profile'

export default function RevisionPanelActions() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
      {PANEL_ACTIONS.map((action, index) => {
        const captionId = `panel-action-${action.key}-hint`
        return (
          <li key={action.key} className="space-y-1">
            <span title={action.hint} className="block">
              <Button
                type="button"
                disabled
                variant={index === 0 ? 'default' : 'outline'}
                className="w-full"
                aria-describedby={captionId}
              >
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
