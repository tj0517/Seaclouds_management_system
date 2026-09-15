/**
 * The payload `updateProject` sends to public.projects.
 *
 * `project_code` is absent by design, not omission: it is the first segment of
 * every SCL document number (SC2601-SCL-RA-0012-EN, docs/00-glossary.md) and is
 * already embedded in CTR codes (SC2699_CTR100) and in timesheet history, so
 * changing it would retroactively alter numbers already issued. Since 1a.17c
 * the database refuses the change outright — trigger
 * projects_project_code_immutable, migration 20260915081813 — for every caller
 * including an admin, so a payload that still carried the key would fail with
 * 23001 instead of saving. The edit dialog renders the code read-only for the
 * same reason.
 *
 * A disabled input is omitted from FormData, so reading 'project_code' here
 * would yield null and try to blank a NOT NULL column; the key is dropped
 * rather than blanked.
 *
 * Extracted from the server action so the rule can be asserted directly:
 * vitest.config.ts is node-only, and decisions live in pure exported functions
 * (apps/dcs/lib/* follows the same split).
 *
 * `name` is returned untrimmed and `description` unnormalised, byte-identical
 * to what the action sent before 1a.17c — this task changes which columns are
 * written, not how the remaining ones are read.
 */
export function buildProjectUpdate(formData: FormData) {
  return {
    name: formData.get('name') as string,
    description: formData.get('description') as string,
    is_active: formData.get('is_active') === 'true',
  }
}
