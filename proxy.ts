import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  // 1. Tworzymy odpowiedź domyślną
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // 2. Konfigurujemy klienta Supabase
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    }
  )

  // 3. Pobieramy użytkownika (tylko RAZ)
  // UWAGA: To wywołanie odświeża też token w ciasteczkach jeśli trzeba
  const { data: { user } } = await supabase.auth.getUser()

  // 4. Ochrona tras
  // Jeśli nie ma usera I nie jesteśmy na stronie logowania -> przekieruj
  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
     return NextResponse.redirect(new URL('/login', request.url))
  }

  // 5. Zwracamy odpowiedź (z ewentualnie odświeżonymi ciasteczkami)
  return response
}

// 6. KLUCZOWY ELEMENT - MATCHER
// To naprawia błąd "Unexpected token <"
export const config = {
  matcher: [
    /*
     * Uruchamiaj middleware dla wszystkich ścieżek OPRÓCZ:
     * - api (trasy API)
     * - _next/static (pliki statyczne JS/CSS)
     * - _next/image (obrazy)
     * - favicon.ico (ikona)
     * - plików z rozszerzeniami (png, jpg, etc.)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}