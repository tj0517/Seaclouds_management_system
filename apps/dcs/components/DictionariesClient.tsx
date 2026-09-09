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
    <Tabs defaultValue={DICT_TYPES[0]}>
      <TabsList>
        {DICT_TYPES.map((type) => (
          <TabsTrigger key={type} value={type}>
            {DICT_TYPE_LABELS[type]}
          </TabsTrigger>
        ))}
      </TabsList>
      {DICT_TYPES.map((type) => (
        <TabsContent key={type} value={type}>
          <DictionaryTypeTable dictType={type} rows={rowsByType[type]} canEdit={canEdit} />
        </TabsContent>
      ))}
    </Tabs>
  )
}
