// DCS 1a.13: module switcher configuration.
//
// O-01 (docs/04-open-questions.md) — the portal-wide name — is unresolved.
// This is the ONE place it is spelled out; every UI reference must import
// it rather than repeat the string. PLACEHOLDER pending Sea Clouds sign-off.
export const PORTAL_NAME_PLACEHOLDER = 'SCL Portal'

// Absolute URLs of the portal's separate Next.js deployments (ADR-0002: two
// apps, not one app with route segments — crossing modules is a real
// navigation, not client-side routing). Never hardcode a host: these come
// from env, declared in `build.env` in turbo.json. Timesheet only ever
// links OUT to DCS; `tes` is included for symmetry with apps/dcs's copy of
// this file and isn't read by this app today.
export const MODULE_URLS = {
  tes: process.env.NEXT_PUBLIC_TES_URL,
  dcs: process.env.NEXT_PUBLIC_DCS_URL,
} as const
