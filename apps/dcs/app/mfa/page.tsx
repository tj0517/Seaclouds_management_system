'use client'

// DCS 1a.11 / O-14: TOTP enrolment + challenge for admin/DC 2FA. proxy.ts
// redirects an admin or DC session here whenever aal !== 'aal2'. This page
// covers both cases with one factor list: no verified TOTP factor yet ->
// enrol (QR + verify); a verified factor but an aal1 session -> challenge
// (code only). Employees never reach this route (proxy.ts only redirects
// admin/DC paths).
import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Factor = { id: string; status: string }

export default function MfaPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Enrolment state (no verified factor yet)
  const [enrolling, setEnrolling] = useState(false)
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
      const verified = (data?.totp ?? []).find((f: Factor) => f.status === 'verified')
      if (verified) {
        setFactorId(verified.id)
        setEnrolling(false)
        setLoading(false)
        return
      }
      setEnrolling(true)
      // GoTrue enforces a unique friendly_name per user across factors, and
      // an abandoned enrolment (QR scanned, tab closed before verifying)
      // leaves an unverified factor behind under the default empty name —
      // colliding with a fresh enroll() call (422 mfa_factor_name_conflict).
      // A per-attempt friendly name sidesteps that regardless of what is
      // left over, without needing to enumerate and delete old factors.
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
          {enrolling
            ? 'Admin and Document Controller accounts require an authenticator app. Scan the code, then enter the 6-digit code it shows.'
            : 'Enter the 6-digit code from your authenticator app.'}
        </p>

        {enrolling && qrCode && (
          // totp.qr_code from supabase-js is a raw <svg> XML string, not a
          // data: URI — an <img src> never renders it. Inlining it directly
          // is the documented approach (Supabase's own examples do the
          // same) — the SVG comes from our own GoTrue instance, not user input.
          <div
            className="mb-4 flex justify-center [&_svg]:h-[200px] [&_svg]:w-[200px]"
            dangerouslySetInnerHTML={{ __html: qrCode }}
          />
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
        </form>
      </div>
    </div>
  )
}
