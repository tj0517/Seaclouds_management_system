// Shared helpers for the DCS browser scripts written from DCS 1b.07b on
// (`pending-action.mjs`). The two older scripts (`document-profile.mjs`,
// `new-revision.mjs`) still carry their own copies of these — extracting them was
// deferred until a third script needed them (docs/deferred-tasks.md, yy), and this
// is that third script. Moving the older two onto this file is left undone on
// purpose: it is a refactor of two working scripts, not something 1b.07b needs.
//
// Everything here talks to the LOCAL stack only. `guardLocal()` refuses to run
// against anything else, because these scripts write to the database.
import { chromium } from 'playwright'
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3001'
export const API = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'
export const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? 'supabase_db_Seaclouds_management_system'
export const SHOTS = process.env.E2E_SHOTS ?? path.join(os.tmpdir(), 'dcs-e2e-screenshots')

/** Fixed ids from supabase/fixtures/document_profile.sql (and supabase/seed.sql). */
export const IDS = {
  PEJ: '6c0909ce-9b74-4bda-8e92-10811ff5a0fc', // SC2602
  DOC_A: 'f3000000-0000-4000-8000-000000000001',
  // The CPY loop of pending-action.mjs writes hundreds of audit rows, so it gets a document of its own:
  // DOC_A's History is asserted by document-profile.mjs and the tab reads only the newest 200 rows.
  DOC_PENDING: 'f3000000-0000-4000-8000-0000000000e2',
  DC: 'f1000000-0000-4000-8000-000000000001',
  ORIG: 'f1000000-0000-4000-8000-000000000002',
  OUTSIDER: 'f1000000-0000-4000-8000-000000000003',
  E2E_ADMIN: 'f1000000-0000-4000-8000-0000000000a1',
}
export const TOTP_SECRET = 'JBSWY3DPEHPK3PXP'

export function guardLocal() {
  for (const url of [BASE, API]) {
    if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
      console.error(`Refusing to run: ${url} is not localhost. This script writes to the database.`)
      process.exit(2)
    }
  }
  fs.mkdirSync(SHOTS, { recursive: true })
}

export const psql = (sql) => execSync(`docker exec -i ${DB_CONTAINER} psql -U postgres -tA`, { input: sql }).toString().trim()

const base32 = (s) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of s) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

export const totp = (offsetSteps = 0) => {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offsetSteps))
  const hmac = crypto.createHmac('sha1', base32(TOTP_SECRET)).update(counter).digest()
  const offset = hmac[19] & 15
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1e6).padStart(6, '0')
}

export const launch = () => chromium.launch()

/** Signs in with the shared local password; console errors and page errors go to `errors`. */
export async function session(browser, email, errors, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true })
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${email}: ${m.text().slice(0, 300)}`)
  })
  page.on('pageerror', (e) => errors.push(`${email}: pageerror ${e.message.slice(0, 300)}`))
  await page.goto(`${BASE}/login`)
  await page.fill('#email', email)
  await page.fill('#password', 'password123')
  await page.click('button[type=submit]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 })
  return { ctx, page }
}

/**
 * aal1 -> aal2 through the real /mfa page, with a code computed from the fixture
 * secret. One retry with the next time step: two sessions signed in inside the
 * same 30 s window can be handed the same code, which the server may refuse.
 */
export async function toAal2(page, next) {
  for (const offset of [0, 1]) {
    await page.goto(`${BASE}/mfa?next=${encodeURIComponent(next)}`)
    await page.waitForSelector('input[inputmode=numeric]')
    await page.fill('input[inputmode=numeric]', totp(offset))
    const left = await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith('/mfa'), { timeout: 8000 }).then(() => true, () => false),
      page.keyboard.press('Enter'),
    ])
    if (left[0]) {
      await page.waitForLoadState('networkidle')
      await page.waitForSelector('h1', { timeout: 15000 })
      return
    }
  }
  throw new Error('toAal2: the second factor was refused twice')
}

/** Navigates and waits for the page: a route with a loading.tsx shows its skeleton first. */
export async function go(page, url) {
  const response = await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !document.querySelector('.animate-pulse'), null, { timeout: 15000 }).catch(() => undefined)
  return response
}

/** `page.waitForFunction` as a boolean: true when it held before the timeout, false when it did not. */
export const holds = (page, fn, arg, timeout) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false)

export const shot = (page, name, options = {}) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), caret: 'initial', ...options })

export { here }
