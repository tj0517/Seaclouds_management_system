import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Node environment only, on purpose (DCS 1a.12): no jsdom/RTL. Components
// stay untested-but-trivial wrappers around pure, exported decision
// functions (see components/IfRole.tsx), which is what gets tested here.
//
// DCS 1b.07 — a deliberate second tool, not a step back from the above: what a
// PAGE does (RLS deciding what three sessions see, a server action writing, the
// audit row appearing in History) is proven in a real browser with Playwright
// (apps/dcs/e2e, a devDependency), run by hand against the local stack. It is
// not in CI and never in this suite. docs/03-conventions.md, "Testy
// przeglądarkowe".
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
