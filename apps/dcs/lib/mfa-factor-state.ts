export type MfaFactor = {
  id: string
  status: string
  factor_type?: string
  created_at?: string
}

export type MfaFactorState =
  | { mode: 'verified'; factorId: string }
  | { mode: 'pending'; factorId: string }
  | { mode: 'new' }

/**
 * Decides what /mfa should do for a signed-in user's existing factors.
 *
 * GoTrue only ever returns a TOTP factor's secret/QR from the enroll() call
 * that created it — never again from listFactors(). So an existing
 * unverified factor must be reused (challenge it directly, no QR to show)
 * rather than re-enrolled: a second enroll() mints a new secret and silently
 * orphans whatever the user already scanned into their authenticator app.
 * Only enroll a fresh factor when none exists at all.
 */
export function resolveMfaFactorState(factors: MfaFactor[]): MfaFactorState {
  const totp = factors.filter((f) => (f.factor_type ?? 'totp') === 'totp')

  const verified = totp.find((f) => f.status === 'verified')
  if (verified) return { mode: 'verified', factorId: verified.id }

  const pending = totp
    .filter((f) => f.status !== 'verified')
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
  if (pending) return { mode: 'pending', factorId: pending.id }

  return { mode: 'new' }
}
