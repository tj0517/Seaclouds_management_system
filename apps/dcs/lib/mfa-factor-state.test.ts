import { describe, expect, it } from 'vitest'
import { resolveMfaFactorState } from './mfa-factor-state'

describe('resolveMfaFactorState', () => {
  it('enrolls fresh when there are no factors', () => {
    expect(resolveMfaFactorState([])).toEqual({ mode: 'new' })
  })

  it('reuses a single pending factor instead of enrolling again', () => {
    const factors = [
      { id: 'f1', status: 'unverified', factor_type: 'totp', created_at: '2026-09-05T11:16:17Z' },
    ]
    expect(resolveMfaFactorState(factors)).toEqual({ mode: 'pending', factorId: 'f1' })
  })

  it('picks the most recently created pending factor when several were left behind by repeated reloads', () => {
    const factors = [
      { id: 'f1', status: 'unverified', factor_type: 'totp', created_at: '2026-09-05T11:16:17Z' },
      { id: 'f2', status: 'unverified', factor_type: 'totp', created_at: '2026-09-05T11:16:23Z' },
      { id: 'f3', status: 'unverified', factor_type: 'totp', created_at: '2026-09-05T11:16:30Z' },
      { id: 'f4', status: 'unverified', factor_type: 'totp', created_at: '2026-09-05T11:19:19Z' },
    ]
    expect(resolveMfaFactorState(factors)).toEqual({ mode: 'pending', factorId: 'f4' })
  })

  it('prefers a verified factor over any pending ones', () => {
    const factors = [
      { id: 'f1', status: 'unverified', factor_type: 'totp', created_at: '2026-09-05T11:16:17Z' },
      { id: 'f2', status: 'verified', factor_type: 'totp', created_at: '2026-09-05T12:00:00Z' },
    ]
    expect(resolveMfaFactorState(factors)).toEqual({ mode: 'verified', factorId: 'f2' })
  })

  it('ignores non-totp factors', () => {
    const factors = [{ id: 'p1', status: 'verified', factor_type: 'phone', created_at: '2026-09-05T11:00:00Z' }]
    expect(resolveMfaFactorState(factors)).toEqual({ mode: 'new' })
  })
})
