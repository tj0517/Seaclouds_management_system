import { describe, expect, it } from 'vitest'
import { buildProjectUpdate } from './project-update'

function form(entries: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

describe('buildProjectUpdate', () => {
  it('never sends project_code, even when the form carries one', () => {
    const payload = buildProjectUpdate(
      form({ name: 'PEJ/131/2026', description: 'UXO & GEO', is_active: 'true', project_code: 'SC9999' }),
    )
    expect(payload).not.toHaveProperty('project_code')
  })

  it('sends exactly the three editable columns', () => {
    const payload = buildProjectUpdate(form({ name: 'PEJ/131/2026', description: 'UXO & GEO', is_active: 'true' }))
    expect(payload).toEqual({ name: 'PEJ/131/2026', description: 'UXO & GEO', is_active: true })
    expect(Object.keys(payload).sort()).toEqual(['description', 'is_active', 'name'])
  })

  it('treats a missing is_active checkbox as false — an unchecked box sends nothing', () => {
    expect(buildProjectUpdate(form({ name: 'X', description: '' })).is_active).toBe(false)
  })

  it('does not reintroduce project_code as null when the form omits it', () => {
    // The disabled input in EditProjectDialog is omitted from FormData. A
    // builder that still read the field would send null and hit both the
    // trigger (23001) and NOT NULL (23502) on public.projects.
    const payload = buildProjectUpdate(form({ name: 'X', description: 'Y', is_active: 'true' }))
    expect(Object.prototype.hasOwnProperty.call(payload, 'project_code')).toBe(false)
  })
})
