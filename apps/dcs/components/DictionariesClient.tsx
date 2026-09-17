'use client'

// DCS 1a.15: tab shell over the 7 dict_type values — one DictionaryTypeTable
// per tab. Tabs are derived from DICT_TYPES (lib/dictionaries.ts), not
// hand-typed, so a future type addition (a migration + a DICT_TYPES entry)
// shows up here automatically.
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import DictionaryTypeTable from '@/components/DictionaryTypeTable'
import { DICT_TYPES, DICT_TYPE_LABELS, type DictionaryRow, type DictType } from '@/lib/dictionaries'

type Props = {
  rowsByType: Record<DictType, DictionaryRow[]>
  canEdit: boolean
}

export default function DictionariesClient({ rowsByType, canEdit }: Props) {
  return (
    // DCS 1a.24: the tabs are client state and every panel is already in the
    // payload — switching one has no server round trip and nothing to wait
    // for. What was missing was the affordance, not the feedback: the strip
    // now scrolls on a phone instead of wrapping into three ragged rows.
    <Tabs defaultValue={DICT_TYPES[0]}>
      {/* Plain overflow container, no negative-margin bleed: -mx-4 made this
          strip 16px wider than PageBody, which the 375px reachability check
          correctly flagged as content outside a box that cannot scroll. */}
      <div className="overflow-x-auto pb-1">
        <TabsList className="w-max">
          {DICT_TYPES.map((type) => (
            <TabsTrigger key={type} value={type}>
              {DICT_TYPE_LABELS[type]}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {DICT_TYPES.map((type) => (
        <TabsContent key={type} value={type} className="mt-4">
          <DictionaryTypeTable dictType={type} rows={rowsByType[type]} canEdit={canEdit} />
        </TabsContent>
      ))}
    </Tabs>
  )
}
