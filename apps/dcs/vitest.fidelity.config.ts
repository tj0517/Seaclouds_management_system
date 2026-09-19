import { defineConfig } from 'vitest/config'
import path from 'node:path'

// DCS 1b.06: the config that runs the export-fidelity proof, and ONLY it.
//
// A second config rather than a wider `include` in vitest.config.ts, because
// this suite must never run in CI: it needs a running `supabase start` and a
// `psql` on PATH, and — unlike every other test in this repo — it WRITES TO A
// DATABASE. Keeping it behind its own config means `pnpm test:unit` cannot
// pick it up by accident.
//
//   NODE_OPTIONS=--experimental-websocket \
//     pnpm --filter @scl/dcs exec vitest run --config vitest.fidelity.config.ts
//
// The flag is required on Node 20: supabase-js initialises a realtime client
// inside createClient() and needs a global WebSocket. See the header of
// lib/mdr-export.fidelity.ts.
//
// Single-threaded and serial: the cases share one seeded fixture set and one
// teardown, so running them in parallel workers would have them delete each
// other's rows.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/*.fidelity.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
