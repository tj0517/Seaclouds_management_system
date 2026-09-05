'use client'

// DCS 1a.11 / O-14: TOTP enrolment + challenge for admin/DC 2FA. proxy.ts
// redirects an admin or DC session here whenever aal !== 'aal2'. This page
// covers both cases with one factor list: no verified TOTP factor yet ->
// enrol (QR + verify); a verified factor but an aal1 session -> challenge
// (code only). Employees never reach this route (proxy.ts only redirects
// admin/DC paths).
import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@scl/db/client'
import { Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { resolveMfaFactorState } from '@/lib/mfa-factor-state'

export default function MfaPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-1">
          <CardTitle className="text-2xl font-bold">Two-factor authentication</CardTitle>
          <CardDescription>
            {mode === 'new' &&
              'Admin and Document Controller accounts require an authenticator app. Scan the code, then enter the 6-digit code it shows.'}
            {mode === 'pending' &&
              'You already started setting up an authenticator app for this account but did not finish. Enter the 6-digit code it is showing, or start over with a new code.'}
            {mode === 'verified' && 'Enter the 6-digit code from your authenticator app.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mode === 'new' && qrCode && (
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
            <div className="space-y-2">
              <Label htmlFor="code">Authentication code</Label>
              <Input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting || !factorId}>
              {submitting ? 'Verifying…' : 'Verify'}
            </Button>

            {mode === 'pending' && (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={submitting || startingOver}
                onClick={handleStartOver}
              >
                {startingOver ? 'Starting over…' : 'Start over with a new code'}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
