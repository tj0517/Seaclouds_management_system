// DCS 1b.07: the tabs that arrive later. Each is its own component so the task
// that fills one replaces one file and nothing else on the profile moves; the
// sentence and the task/phase it names live in PLACEHOLDER_TABS
// (lib/document-profile.ts), where a test pins them.
import { EmptyState } from '@/components/page-chrome'
import { PLACEHOLDER_TABS, type PlaceholderTab } from '@/lib/document-profile'

function entry(value: string): PlaceholderTab {
  const found = PLACEHOLDER_TABS.find((tab) => tab.value === value)
  if (!found) throw new Error(`PlaceholderTabs: no PLACEHOLDER_TABS entry for "${value}"`)
  return found
}

function Placeholder({ tab }: { tab: PlaceholderTab }) {
  return <EmptyState title={`${tab.label} — not available yet`}>{tab.sentence}</EmptyState>
}

export function RevisionsTab() {
  return <Placeholder tab={entry('revisions')} />
}
export function PlanTab() {
  return <Placeholder tab={entry('plan')} />
}
export function CommentsTab() {
  return <Placeholder tab={entry('comments')} />
}
export function ReferencesTab() {
  return <Placeholder tab={entry('references')} />
}
export function TransmittalsTab() {
  return <Placeholder tab={entry('transmittals')} />
}
