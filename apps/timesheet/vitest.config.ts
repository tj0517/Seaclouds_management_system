import { defineConfig } from 'vitest/config'

// Node environment only, matching apps/dcs: no jsdom/RTL. Components stay
// untested-but-trivial wrappers around pure, exported decision functions.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
})
