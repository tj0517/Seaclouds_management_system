import { describe, expect, it } from 'vitest'
import { isNavItemActive } from './nav'

describe('isNavItemActive', () => {
  it('marks the project list only on the project list itself', () => {
    expect(isNavItemActive('/', '/')).toBe(true)
  })

  // The whole reason "/" is special-cased: every path starts with it, so a
  // prefix match would light up Projects on every screen in the app.
  it.each(['/admin/clients', '/admin/dictionaries', '/admin/projects/new'])(
    'does not mark the project list on %s',
    (pathname) => {
      expect(isNavItemActive('/', pathname)).toBe(false)
    },
  )

  it('marks an admin entry on its own page', () => {
    expect(isNavItemActive('/admin/dictionaries', '/admin/dictionaries')).toBe(true)
    expect(isNavItemActive('/admin/clients', '/admin/clients')).toBe(true)
  })

  it('marks an admin entry on a page below it', () => {
    expect(isNavItemActive('/admin/dictionaries', '/admin/dictionaries/doc_type')).toBe(true)
  })

  it('does not let one entry claim another', () => {
    expect(isNavItemActive('/admin/dictionaries', '/admin/clients')).toBe(false)
    expect(isNavItemActive('/admin/clients', '/admin/dictionaries')).toBe(false)
  })

  // /admin/clients must not match /admin/clients-archive: the boundary is a
  // path separator, not a character count.
  it('matches on a path segment boundary, not a string prefix', () => {
    expect(isNavItemActive('/admin/clients', '/admin/clients-archive')).toBe(false)
    expect(isNavItemActive('/admin/clients', '/admin/clientsomething')).toBe(false)
  })

  it('leaves the screens with no sidebar entry unmarked', () => {
    // /admin/projects/[id] and /admin/users/[id] are reached from a row, not
    // from the sidebar (docs/03-conventions.md), so nothing lights up.
    for (const href of ['/', '/admin/dictionaries', '/admin/clients']) {
      expect(isNavItemActive(href, '/admin/projects/abc')).toBe(false)
      expect(isNavItemActive(href, '/admin/users/abc')).toBe(false)
    }
  })
})
