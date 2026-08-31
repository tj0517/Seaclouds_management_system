import { NextResponse } from 'next/server'
import { createClient } from '@scl/db/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/login', request.url), { status: 302 })
}
