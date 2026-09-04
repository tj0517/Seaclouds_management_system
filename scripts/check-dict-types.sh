#!/usr/bin/env bash
# Guard (DCS 1a.07): DICT_TYPES in apps/dcs/lib/dictionaries.ts must equal the
# value list of the CHECK constraint on dcs.dictionaries.dict_type in the
# database built from migrations. dict_type is text, so the generated types
# cannot carry this list — this script makes drift a CI failure instead of a
# surprise at seed time. Runs against the local Supabase stack (CI: after
# `supabase db reset`; locally: `supabase start`).
set -euo pipefail

TS_FILE="apps/dcs/lib/dictionaries.ts"
# First `project_id` in config.toml is the local project; the [remotes.*]
# sections carry their own project_id lines further down.
CONTAINER="supabase_db_$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml | head -n 1)"

ts_values=$(
  awk '/export const DICT_TYPES = \[/{f=1; next} f && /\] as const/{exit} f' "$TS_FILE" \
    | grep -o "'[a-z_]*'" | tr -d "'" | sort
)

db_values=$(
  docker exec "$CONTAINER" psql -U postgres -d postgres -At -c "
    select m[1]
      from pg_constraint c
      cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') as m
     where c.conrelid = 'dcs.dictionaries'::regclass and c.contype = 'c'
     order by 1" \
    | sort
)

if [[ -z "$ts_values" || -z "$db_values" ]]; then
  echo "::error::check-dict-types: could not read DICT_TYPES (${#ts_values} chars) or the CHECK list (${#db_values} chars)"
  exit 1
fi

if [[ "$ts_values" != "$db_values" ]]; then
  echo "::error::DICT_TYPES in $TS_FILE differs from the dict_type CHECK in the database"
  diff <(echo "$ts_values") <(echo "$db_values") || true
  exit 1
fi

echo "check-dict-types: OK ($(wc -l <<<"$db_values" | tr -d ' ') types)"
