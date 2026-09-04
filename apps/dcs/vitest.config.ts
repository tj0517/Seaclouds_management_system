import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Node environment only, on purpose (DCS 1a.12): no jsdom/RTL. Components
// stay untested-but-trivial wrappers around pure, exported decision
// functions (see components/IfRole.tsx), which is what gets tested here.
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
