// DCS 1b.06: saved views of the MDR register — the read and write layer.
//
// Same split as lib/mdr.ts: takes any typed Supabase client, imports nothing
// from Next.js, runs from an RSC, a server action or a Vitest test alike.
//
// NOTHING HERE IS A GUARD. Every function below reads or writes
// dcs.user_views under the caller's own RLS, and the four owner-only policies
// are what make a view private — not the `.eq('user_id', …)` in a query, which
// is scoping. The proof is supabase/tests/user_views_rls.test.sql, where every
// cross-user assertion is a bare count with no WHERE.
//
// The one thing worth knowing before reading on: `filters` and `columns` come
// back from the database as arbitrary JSON. They were written by this app, but
// "written by this app" is not a type — a hand-edited row, a column added to
// the register since the view was saved, or a value from a future version all
// arrive here. So the restore path goes through parseMdrSearchParams(), the
// same total function the URL goes through, and an unusable saved filter
// degrades to the default rather than throwing on a screen the whole company
// opens.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables } from '@scl/db'
import {
  MDR_ALL_COLUMN_KEYS,
  normaliseColumnSelection,
  parseMdrSearchParams,
  type MdrQuery,
  type RawSearchParams,
} from './mdr'

export type UserView = Tables<{ schema: 'dcs' }, 'user_views'>

type DbClient = SupabaseClient<Database>

/** Matches the CHECK in the migration; the form refuses before the database has to. */
export const USER_VIEW_NAME_MAX = 120

export type ViewActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

/**
 * The saved views, ordered the way the dropdown lists them: the default first,
 * then alphabetically.
 *
 * Ordered by Postgres and not here, for the reason lib/mdr.ts is built around
 * — no .sort() on rows a query returned. It matters less at the handful of
 * rows a person saves, but the rule is worth more than the exception.
 */
export async function listUserViews(supabase: DbClient): Promise<UserView[]> {
  const { data, error } = await supabase
    .schema('dcs')
    .from('user_views')
    .select('*')
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })
  if (error) throw new Error(`listUserViews: ${error.message}`)
  return data ?? []
}

/**
 * The view to apply on entering /mdr, or null.
 *
 * A bare `.eq('is_default', true)` with no user filter: RLS already restricts
 * the rows to the caller's own, and the partial unique index guarantees at
 * most one of them. maybeSingle() rather than single() because "no default
 * view" is the normal state, not an error.
 */
export async function getDefaultUserView(supabase: DbClient): Promise<UserView | null> {
  const { data, error } = await supabase
    .schema('dcs')
    .from('user_views')
    .select('*')
    .eq('is_default', true)
    .maybeSingle()
  if (error) throw new Error(`getDefaultUserView: ${error.message}`)
  return data ?? null
}

/**
 * A saved view turned back into the register's query.
 *
 * Runs the stored `filters` through parseMdrSearchParams — the SAME function
 * the URL goes through — so a saved view and a bookmarked URL cannot mean
 * different things, and neither can produce a query the screen would refuse.
 * That is also what makes the restore safe against whatever is actually in the
 * jsonb: every malformed value becomes a default.
 */
export function viewToQuery(view: Pick<UserView, 'filters' | 'columns'>): MdrQuery {
  const filters: RawSearchParams = {}
  if (view.filters && typeof view.filters === 'object' && !Array.isArray(view.filters)) {
    for (const [key, value] of Object.entries(view.filters)) {
      if (typeof value === 'string') filters[key] = value
    }
  }

  const query = parseMdrSearchParams(filters)
  return {
    ...query,
    // A saved view is a way of LOOKING at the register, not a position in it —
    // queryToFilters never writes `page`, but the jsonb is whatever the row
    // holds, and restoring onto page 7 of a two-page result is the empty table
    // that mdrHref already refuses to produce for a filter change.
    page: 1,
    columns: columnsFromJson(view.columns),
  }
}

/** The stored column list, defended against anything that is not an array of known keys. */
function columnsFromJson(raw: UserView['columns']): string[] {
  if (!Array.isArray(raw)) return []
  return normaliseColumnSelection(raw.filter((key): key is string => typeof key === 'string'))
}

/**
 * The register's query as the flat string map a saved view stores.
 *
 * Deliberately the same key names the URL uses (`project`, `type`, `q`, …)
 * rather than MdrQuery's field names: the stored object is then literally a
 * query string in object form, which is what makes viewToQuery() able to hand
 * it straight to parseMdrSearchParams. `page` is never stored — a saved view
 * is a way of looking at the register, not a position in it.
 */
export function queryToFilters(query: MdrQuery): Record<string, string> {
  const filters: Record<string, string> = {}
  if (query.projectId) filters.project = query.projectId
  if (query.docTypeId) filters.type = query.docTypeId
  if (query.originatorId) filters.orig = query.originatorId
  if (query.workflowStatusId) filters.status = query.workflowStatusId
  if (query.disciplineId) filters.discipline = query.disciplineId
  if (query.search) filters.q = query.search
  filters.sort = query.sort
  filters.dir = query.ascending ? 'asc' : 'desc'
  return filters
}

/** Trimmed, and checked against the same bounds as the database's CHECK. */
export function validateViewName(name: string): ViewActionResult<string> {
  const trimmed = name.trim()
  if (trimmed.length === 0) return { ok: false, error: 'Give the view a name.' }
  if (trimmed.length > USER_VIEW_NAME_MAX) {
    return { ok: false, error: `A name can be at most ${USER_VIEW_NAME_MAX} characters.` }
  }
  return { ok: true, data: trimmed }
}

/**
 * Turns the database's own refusals into something a person can act on.
 *
 * 23505 has two distinct causes on this table and they need different
 * sentences: a duplicate NAME is the user's to fix, while a duplicate DEFAULT
 * means another tab won the race described in the migration header, and the
 * honest answer is "try again", not "that name is taken". The constraint name
 * is what tells them apart — the message text is not something to parse.
 */
function explain(error: { code?: string; message: string }): string {
  if (error.code === '23505') {
    if (error.message.includes('user_views_one_default_per_user')) {
      return 'Another tab changed your default view at the same time. Reload and try again.'
    }
    return 'You already have a view with that name.'
  }
  if (error.code === '23514') return 'That name cannot be used.'
  if (error.code === '42501') return 'You can only change your own saved views.'
  return error.message
}

/**
 * Saves the register's current state as a named view, replacing one of the
 * same name.
 *
 * An upsert on (user_id, name) rather than an insert, because "Save current
 * view" typed over an existing name means "update it" to everyone who has ever
 * used a register — and an error there would be the app enforcing a database
 * detail the user has no way to see.
 *
 * user_id is read from the session rather than taken as an argument: a
 * caller-supplied id would be refused by the INSERT policy's WITH CHECK
 * anyway, but taking it here at all would make this function look like a place
 * where ownership is decided. It is not.
 */
export async function saveUserView(
  supabase: DbClient,
  input: { name: string; query: MdrQuery },
): Promise<ViewActionResult<UserView>> {
  const name = validateViewName(input.name)
  if (!name.ok) return name

  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { ok: false, error: 'No session.' }

  const { data, error } = await supabase
    .schema('dcs')
    .from('user_views')
    .upsert(
      {
        user_id: auth.user.id,
        name: name.data,
        filters: queryToFilters(input.query),
        // Stored as the user chose them, empty meaning "every column" — see
        // normaliseColumnSelection. Saving all 35 keys instead would hide
        // Phase 2's new columns from anyone holding an old view.
        columns: normaliseColumnSelection(input.query.columns),
      },
      { onConflict: 'user_id,name' },
    )
    .select()
    .single()

  if (error) return { ok: false, error: explain(error) }
  return { ok: true, data }
}

export async function renameUserView(
  supabase: DbClient,
  id: string,
  name: string,
): Promise<ViewActionResult> {
  const checked = validateViewName(name)
  if (!checked.ok) return checked

  const { error } = await supabase
    .schema('dcs')
    .from('user_views')
    .update({ name: checked.data })
    .eq('id', id)
  if (error) return { ok: false, error: explain(error) }
  return { ok: true, data: undefined }
}

export async function deleteUserView(supabase: DbClient, id: string): Promise<ViewActionResult> {
  const { error } = await supabase.schema('dcs').from('user_views').delete().eq('id', id)
  if (error) return { ok: false, error: explain(error) }
  return { ok: true, data: undefined }
}

/**
 * Marks one view as the one /mdr opens on — CLEAR, then SET.
 *
 * Two requests, in that order, and the order is the whole argument: the
 * intermediate state is ZERO defaults, which the partial unique index permits,
 * where SET-then-CLEAR would raise 23505 on the first statement. PostgREST
 * cannot express `set is_default = (id = $1)` in one request; the migration
 * header records why an RPC was weighed and not taken.
 *
 * Passing null clears the default without setting another — "open the register
 * plain", which a user who has set a default otherwise has no way back to.
 */
export async function setDefaultUserView(
  supabase: DbClient,
  id: string | null,
): Promise<ViewActionResult> {
  // No user filter on either statement: RLS restricts both to the caller's own
  // rows. `.eq('is_default', true)` is there to touch only the row that needs
  // it, not to decide whose rows these are.
  const cleared = await supabase
    .schema('dcs')
    .from('user_views')
    .update({ is_default: false })
    .eq('is_default', true)
  if (cleared.error) return { ok: false, error: explain(cleared.error) }

  if (id === null) return { ok: true, data: undefined }

  const { error } = await supabase
    .schema('dcs')
    .from('user_views')
    .update({ is_default: true })
    .eq('id', id)
  if (error) return { ok: false, error: explain(error) }
  return { ok: true, data: undefined }
}

/** The column keys a picker offers, so a caller need not import the groups. */
export const SELECTABLE_COLUMN_KEYS = MDR_ALL_COLUMN_KEYS
