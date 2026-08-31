import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Corrupted-JWT detection (e.g. Safari cookie truncation) — same failure mode
// the Timesheet proxy handles; the error shape comes from supabase-js internals.
function isCorruptedJwtError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { message, code } = error as { message?: unknown; code?: unknown }
  return (
    (typeof message === 'string' &&
      (message.includes('JWS') || message.includes('Compact'))) ||
    code === 'bad_jwt'
  )
}

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value)
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  // getUser() also refreshes the token in cookies when needed.
  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch (error) {
    if (isCorruptedJwtError(error)) {
      const redirectResponse = NextResponse.redirect(new URL('/login', request.url))
      for (const cookie of request.cookies.getAll()) {
        if (cookie.name.includes('auth-token')) {
          redirectResponse.cookies.delete(cookie.name)
        }
      }
      return redirectResponse
    }
    throw error
  }

  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return response
}

export const config = {
  // Everything except static assets and files with extensions.
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
