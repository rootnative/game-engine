import { defineConfig } from 'vitest/config'

// The tests live outside `src/`, because `src/` ships in the npm tarball.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
})
