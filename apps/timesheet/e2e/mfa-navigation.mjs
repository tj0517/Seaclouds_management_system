// Timesheet 1a.25c — browser regression guard for /mfa's post-verify navigation,
// run by hand against the LOCAL stack. Not part of CI (docs/03-conventions.md,
// "Testy przeglądarkowe").
//
// The bug this guards shipped twice: after a CORRECT code the page hung on
// "Verifying…" — DCS 1a.25 (17 Sep), Timesheet 1a.25b (20 Sep, #76). The click on
// the "Admin" link leaves a route-cache entry under /admin whose canonicalUrl is
// /mfa?next=%2Fadmin (that is where proxy.ts's aal2 gate resolved it), so a
// client-side router.push('/admin') resolves straight back to /mfa and never asks
// the server. The fix is a full document load (lib/mfa-navigation.ts).
//
// Why it asserts on the SHAPE of the navigation and not only on the final URL:
// the first same-origin request after the submit must be a DOCUMENT request for
// the target path. A test that only waited for "URL is /admin" could pass on a
// cached client-side push — which is exactly what the bug is not. The
// unit-level model of the same rule is lib/mfa-verify-navigation.test.ts; this
// is the real browser, the real proxy.ts and the real Next.js route cache.
//
// Three modes, one case each, because they differ in what listFactors() returns
// on mount and the navigation must not depend on which one it is:
//   verified   a verified TOTP factor exists   -> code only (aal1 -> aal2)
//   enrolment  no factor at all                -> QR + code
//   pending    an unverified factor left over  -> code only, "Start over" offered
//
// Prerequisites (all local, see docs/03-conventions.md):
//   1. `supabase start` + `supabase db reset`. No other fixture is needed: this
//      script creates its own three admin users (e2e.mfa.*@local.test) and puts
//      their factors into the state each case needs.
//   2. the app against the local stack (apps/timesheet/.env.local ->
//      NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321), by default a PRODUCTION
//      build: `next build`, `next start -p 3100`, E2E_BASE_URL=http://localhost:3100.
//      `pnpm --filter @scl/timesheet dev` (port 3000, the default BASE) is the fast
//      variant: on `next dev` the reverted page still ends on /admin, so it is caught
//      only by the request shape; only a build reproduces the hang itself. Never
//      weaken the shape assertions below to a URL check.
//   3. a browser: `pnpm --filter @scl/timesheet exec playwright install chromium`
// Then: `pnpm --filter @scl/timesheet e2e:mfa`. Exit code 1 if any check fails,
// 2 if it refuses to run.
//
// It WRITES to the local database (creates the three users, replaces THEIR MFA
// factors and sessions — nobody else's), so it refuses to run against anything
// that is not localhost, and it aborts every browser request to a non-local host:
// the app's own Supabase URL comes from its .env.local, not from this script, so
// a dev server pointed at scl-dev or production would otherwise enrol and verify
// factors there. A blocked request fails the run (exit 1) before it can do harm.
//
// Optional environment: E2E_BASE_URL, E2E_SUPABASE_URL, E2E_DB_CONTAINER,
// E2E_SHOTS (screenshot directory, default: the OS temp dir).
/* global window */
import { chromium } from 'playwright'
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const API = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? 'supabase_db_Seaclouds_management_system'
const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'timesheet-e2e-screenshots')
const LOCAL_HOSTS = ['localhost', '127.0.0.1']

for (const url of [BASE, API]) {
  if (!LOCAL_HOSTS.includes(new URL(url).hostname)) {
    console.error(`Refusing to run: ${url} is not localhost. This script writes to the database.`)
    process.exit(2)
  }
}
fs.mkdirSync(SHOTS, { recursive: true })

const TARGET = '/admin'
const PASSWORD = 'password123'

// Fixed ids, so the setup below is idempotent and a run never piles up users.
const USERS = {
  verified: { id: 'f5000000-0000-4000-8000-000000000001', email: 'e2e.mfa.verified@local.test', name: 'E2E MFA Verified' },
  enrolment: { id: 'f5000000-0000-4000-8000-000000000002', email: 'e2e.mfa.enrolment@local.test', name: 'E2E MFA Enrolment' },
  pending: { id: 'f5000000-0000-4000-8000-000000000003', email: 'e2e.mfa.pending@local.test', name: 'E2E MFA Pending' },
}
const SECRETS = { verified: 'JBSWY3DPEHPK3PXP', pending: 'GEZDGNBVGY3TQOJQ' }

const base32 = (s) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of s) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}
const totp = (secret) => {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const hmac = crypto.createHmac('sha1', base32(secret)).update(counter).digest()
  const offset = hmac[19] & 15
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1e6).padStart(6, '0')
}
const psql = (sql) =>
  execSync(`docker exec -i ${DB_CONTAINER} psql -U postgres -v ON_ERROR_STOP=1 -tA`, { input: sql }).toString().trim()

const results = []
const consoleErrors = []
const blocked = []
const rec = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

// ---------------- setup: three admins, each with the factors its case needs ----------------
// Same shape as supabase/fixtures/document_profile.sql: plain SQL as postgres,
// the profile row comes from the trigger on auth.users. role = 'admin' is what
// proxy.ts's aal2 gate looks at, and what app/admin/layout.tsx lets through.
function ensureUsers() {
  const rows = Object.values(USERS).map((u) => `('${u.id}', '${u.email}', '${u.name}')`).join(',\n    ')
  psql(`
begin;
set local search_path = public, extensions;
create temp table e2e_users (id uuid, email text, full_name text) on commit drop;
insert into e2e_users values
    ${rows};

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token,
  phone_change, phone_change_token, email_change_token_current, email_change_confirm_status)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, extensions.crypt('${PASSWORD}', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', u.full_name),
  now(), now(), '', '', '', '', '', '', '', 0
from e2e_users u
where not exists (select 1 from auth.users x where x.id = u.id);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from e2e_users u
where not exists (select 1 from auth.identities i where i.user_id = u.id);

update public.profiles p set full_name = u.full_name, role = 'admin'
from e2e_users u where p.id = u.id;

insert into public.module_permissions (user_id, module)
select u.id, 'tes' from e2e_users u
where not exists (select 1 from public.module_permissions m where m.user_id = u.id and m.module = 'tes');
commit;`)
}

/** Known starting state for one user: fresh sessions (aal1 on login) and exactly the factors the mode needs. */
function resetFactors(mode) {
  const { id } = USERS[mode]
  const factor = (status) => `
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), '${id}', 'e2e ${mode}', 'totp', '${status}', now(), now(), '${SECRETS[mode]}');`
  psql(`
begin;
delete from auth.sessions where user_id = '${id}';
delete from auth.mfa_factors where user_id = '${id}';
${mode === 'verified' ? factor('verified') : ''}${mode === 'pending' ? factor('unverified') : ''}
commit;`)
}

// ---------------- one case ----------------
// caret: 'initial' matters. Playwright's default (hide) writes an inline
// `caret-color: transparent` onto every <input> for the duration of the shot; taken
// while /admin is still hydrating, that inline style is a server/client attribute
// mismatch and React reports it as a hydration error — a false positive that hopped
// between cases from run to run (seen while writing this).
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), caret: 'initial' })

const isAppRequest = (url) => {
  const u = new URL(url)
  return u.origin === new URL(BASE).origin && !u.pathname.startsWith('/_next/') && !u.pathname.startsWith('/__nextjs')
}
const label = (r) => `${r.rsc ? 'RSC' : r.type.toUpperCase()} ${r.method} ${r.path}`

async function runCase(browser, mode, checkMode) {
  const user = USERS[mode]
  resetFactors(mode)

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  // See the header: nothing may leave this machine.
  await ctx.route('**/*', (route) => {
    const { hostname } = new URL(route.request().url())
    if (LOCAL_HOSTS.includes(hostname) || route.request().url().startsWith('data:')) return route.continue()
    blocked.push(route.request().url())
    return route.abort()
  })
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(`${mode} @ ${new URL(page.url()).pathname}: ${m.text().slice(0, 300)}`)
  })
  page.on('pageerror', (e) => consoleErrors.push(`${mode}: pageerror ${e.message.slice(0, 300)}`))

  const log = []
  page.on('request', (r) => {
    if (!isAppRequest(r.url())) return
    const u = new URL(r.url())
    log.push({ type: r.resourceType(), method: r.method(), path: u.pathname + u.search, rsc: r.headers()['rsc'] !== undefined, nav: r.isNavigationRequest() })
  })
  // The secret of a factor enrolled by the page is returned once, by the enroll
  // call — it is never readable afterwards, so it is taken off the wire here.
  let enrolledSecret
  page.on('response', async (res) => {
    if (res.request().method() === 'POST' && new URL(res.url()).pathname === '/auth/v1/factors') {
      enrolledSecret = (await res.json().catch(() => null))?.totp?.secret
    }
  })

  try {
    // Fresh login -> /tes -> the "Admin" link, the way an admin really gets to /mfa.
    // (A TES-only account skips the portal page and lands on /tes.)
    await page.goto(`${BASE}/login`)
    await page.fill('#email', user.email)
    await page.fill('#password', PASSWORD)
    await page.click('button[type=submit]')
    await page.waitForURL((u) => u.pathname === '/tes', { timeout: 20000 })
    await page.locator(`a[href="${TARGET}"]`).first().click()
    await page.waitForURL((u) => u.pathname === '/mfa', { timeout: 20000 })
    rec(`${mode}: the aal2 gate sent the admin from ${TARGET} to /mfa?next=…`, new URL(page.url()).searchParams.get('next') === TARGET, page.url())

    await page.waitForSelector('input[inputmode=numeric]', { timeout: 15000 })
    await checkMode(page)
    await shot(page, `mfa-${mode}`)

    // Well inside the route cache's 30 s floor, so the poisoned entry for /admin is
    // still fresh when the navigation happens — the case the bug needs.
    const secret = mode === 'enrolment' ? enrolledSecret : SECRETS[mode]
    if (!secret) throw new Error('no TOTP secret: the enroll response was not seen')
    await page.evaluate(() => { window.__e2eMarker = 'same-document' })
    await page.fill('input[inputmode=numeric]', totp(secret))

    const mark = log.length
    await page.keyboard.press('Enter')
    const arrived = await page
      .waitForURL((u) => u.pathname === TARGET, { timeout: 15000 })
      .then(() => true, () => false)

    const after = log.slice(mark)
    const first = after[0]
    console.log(`      requests to the app after submit: ${after.map(label).join('  →  ') || '(none)'}`)
    rec(
      `${mode}: the FIRST request after submit is a DOCUMENT navigation to ${TARGET}`,
      first !== undefined && first.type === 'document' && first.nav && !first.rsc && first.path === TARGET,
      first ? `observed ${label(first)}` : 'no request to the app at all',
    )
    rec(
      `${mode}: no client-side (RSC) request went out after submit`,
      after.every((r) => !r.rsc),
      after.filter((r) => r.rsc).map(label).join(', '),
    )
    rec(`${mode}: the browser ends on ${TARGET}, not back on /mfa`, arrived, new URL(page.url()).pathname + new URL(page.url()).search)
    if (arrived) {
      // A document load throws the whole JS context away; a client-side push would keep it.
      rec(`${mode}: the page is a new document (the pre-submit window marker is gone)`, (await page.evaluate(() => window.__e2eMarker)) === undefined)
      await page.waitForSelector('main', { timeout: 15000 })
    } else {
      const button = await page.locator('button[type=submit]').innerText().catch(() => '?')
      console.log(`      stuck on ${page.url()} — submit button says "${button}"`)
    }
    await shot(page, `after-${mode}`)
  } catch (e) {
    rec(`${mode}: the case ran to the end`, false, String(e.message).split('\n')[0].slice(0, 300))
    await shot(page, `error-${mode}`).catch(() => undefined)
  } finally {
    await ctx.close()
  }
}

const QR = 'img[alt="Scan with your authenticator app"]'
const START_OVER = 'button:has-text("Start over with a new code")'
// Each case must be running in the mode it claims, or it proves nothing about that mode.
const MODES = [
  ['verified', async (page) => {
    rec('verified: /mfa is in challenge mode (no QR, no "Start over")', (await page.locator(QR).count()) === 0 && (await page.locator(START_OVER).count()) === 0 && (await page.getByText('Enter the 6-digit code from your authenticator app.').count()) === 1)
  }],
  ['enrolment', async (page) => {
    await page.waitForSelector(QR, { timeout: 15000 })
    rec('enrolment: /mfa shows the QR of a freshly enrolled factor', (await page.locator(QR).count()) === 1)
  }],
  ['pending', async (page) => {
    rec('pending: /mfa reuses the unverified factor ("Start over" offered, no QR)', (await page.locator(START_OVER).count()) === 1 && (await page.locator(QR).count()) === 0)
  }],
]

ensureUsers()
const browser = await chromium.launch()
for (const [mode, check] of MODES) await runCase(browser, mode, check)
await browser.close()

rec('no request left this machine', blocked.length === 0, blocked.slice(0, 3).join(' | '))
rec('no console or hydration errors on any page of any case', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' || '))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${SHOTS}`)
process.exit(failed.length ? 1 : 0)
