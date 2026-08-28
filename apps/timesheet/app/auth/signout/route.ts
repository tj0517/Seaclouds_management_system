import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()

  // Sprawdź sesję (żeby przekierować na login, a nie zostać na chronionej stronie)
  const { data: { session } } = await supabase.auth.getSession()

  if (session) {
    await supabase.auth.signOut()
  }

  // Przekieruj na login, używając poprawnego URL
  return NextResponse.redirect(new URL('/login', request.url), {
    status: 302,
  })
}