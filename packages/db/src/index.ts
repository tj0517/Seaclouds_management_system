// Public type surface of @scl/db. Runtime client factories are exposed via
// the dedicated entry points: `@scl/db/client` (browser) and `@scl/db/server`
// (RSC/server actions) — they must not be re-exported here, because a single
// entry point would drag `next/headers` into client bundles.
export type {
  Json,
  Database,
  Tables,
  TablesInsert,
  TablesUpdate,
  Enums,
  CompositeTypes,
} from './database'
export { Constants } from './database'
