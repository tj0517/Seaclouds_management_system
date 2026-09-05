'use client'

// DCS 1a.11 / O-14: TOTP enrolment + challenge for admin/DC 2FA. proxy.ts
// redirects an admin or DC session here whenever aal !== 'aal2'. This page
// covers both cases with one factor list: no verified TOTP factor yet ->
// enrol (QR + verify); a verified factor but an aal1 session -> challenge
// (code only). Employees never reach this route (proxy.ts only redirects
// admin/DC paths).
import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveMfaFactorState } from '@/lib/mfa-factor-state'

export default function MfaPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center px-4">
          <p className="text-sm text-gray-500">Loading…</p>
        </div>
      }
    >
      <MfaPageInner />
    </Suspense>
  )
}

// useSearchParams() opts the page out of static generation unless wrapped in
// its own Suspense boundary (Next.js requirement for the production build).
function MfaPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [startingOver, setStartingOver] = useState(false)

  // 'new': no factor at all, we just enrolled one (has a QR to show).
  // 'pending': an earlier enroll() already minted a factor and secret that
  // GoTrue will never hand back — reuse it instead of enrolling again.
  // 'verified': normal aal1 -> aal2 challenge, no enrolment involved.
  const [mode, setMode] = useState<'new' | 'pending' | 'verified'>('new')
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)

  // React Strict Mode double-invokes effects in dev; guard against a second
  // concurrent enroll() call from the same mount.
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const supabase = createClient()
    supabase.auth.mfa.listFactors().then(({ data, error: listError }) => {
      if (listError) {
        setError(listError.message)
        setLoading(false)
        return
      }
      const state = resolveMfaFactorState(data?.all ?? [])

      if (state.mode === 'verified' || state.mode === 'pending') {
        setMode(state.mode)
        setFactorId(state.factorId)
        setLoading(false)
        return
      }

      setMode('new')
      // GoTrue enforces a unique friendly_name per user across factors, and
      // an abandoned enrolment (QR scanned, tab closed before verifying)
      // leaves an unverified factor behind under the default empty name —
      // colliding with a fresh enroll() call (422 mfa_factor_name_conflict).
      // A per-attempt friendly name sidesteps that regardless of what is
      // left over.
      supabase.auth.mfa
        .enroll({ factorType: 'totp', friendlyName: `totp-${Date.now()}` })
        .then(({ data: enrollData, error: enrollError }) => {
          if (enrollError) {
            setError(enrollError.message)
          } else if (enrollData) {
            setFactorId(enrollData.id)
            setQrCode(enrollData.totp.qr_code)
          }
          setLoading(false)
        })
    })
  }, [])

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!factorId) return
    setSubmitting(true)
    setError(null)

    const supabase = createClient()
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })

    if (verifyError) {
      setError('Invalid code. Try again.')
      setSubmitting(false)
      return
    }

    router.push(next)
    router.refresh()
  }

  // Discarding a stale, unfinished enrolment is a deliberate user choice, not
  // a side effect of a reload — this is the only place old unverified
  // factors get cleaned up.
  async function handleStartOver() {
    setStartingOver(true)
    setError(null)

    const supabase = createClient()
    const { data } = await supabase.auth.mfa.listFactors()
    const stale = (data?.all ?? []).filter(
      (f) => (f.factor_type ?? 'totp') === 'totp' && f.status !== 'verified'
    )
    await Promise.all(stale.map((f) => supabase.auth.mfa.unenroll({ factorId: f.id })))

    const { data: enrollData, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `totp-${Date.now()}`,
    })

    if (enrollError) {
      setError(enrollError.message)
      setStartingOver(false)
      return
    }

    setMode('new')
    setFactorId(enrollData.id)
    setQrCode(enrollData.totp.qr_code)
    setCode('')
    setStartingOver(false)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-center text-2xl font-bold">Two-factor authentication</h1>
        <p className="mb-6 text-center text-sm text-gray-500">
          {mode === 'new' &&
            'Admin and Document Controller accounts require an authenticator app. Scan the code, then enter the 6-digit code it shows.'}
          {mode === 'pending' &&
            'You already started setting up an authenticator app for this account but did not finish. Enter the 6-digit code it is showing, or start over with a new code.'}
          {mode === 'verified' && 'Enter the 6-digit code from your authenticator app.'}
        </p>

        {mode === 'new' && qrCode && (
          // supabase-js prefixes totp.qr_code with `data:image/svg+xml;utf-8,`
          // itself (see @supabase/auth-js GoTrueClient.enroll) — it's a ready
          // <img src> value, not raw SVG markup to inline.
          <div className="mb-4 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URI, next/image can't optimize it */}
            <img src={qrCode} alt="Scan with your authenticator app" className="h-[200px] w-[200px]" />
          </div>
        )}

        <form onSubmit={handleVerify} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="code" className="text-sm font-medium">
              Authentication code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>

          {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !factorId}
            className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {submitting ? 'Verifying…' : 'Verify'}
          </button>

          {mode === 'pending' && (
            <button
              type="button"
              disabled={submitting || startingOver}
              onClick={handleStartOver}
              className="w-full rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              {startingOver ? 'Starting over…' : 'Start over with a new code'}
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
