import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['vitest.setup.ts'],
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'text-summary', 'lcov'],
      include: ['src/lib/**/*.ts'],
      exclude: [
        'src/lib/db.ts',           // Prisma client singleton
        'src/lib/debug.ts',        // Simple logger
        'src/lib/db-helpers.ts',   // DB wrapper
        'src/lib/admin-settings-helpers.ts', // DB-dependent
      ],
      thresholds: {
        'src/lib/utils.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'src/lib/content-filter-blocked.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'src/lib/content-filter-normalize.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'src/lib/content-filter-engine.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'src/lib/content-filter-checks.ts': { branches: 95, functions: 100, lines: 100, statements: 100 },
        'src/lib/encrypt.ts': { branches: 85, functions: 100, lines: 95, statements: 95 },
        'src/lib/limit-resolver.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'src/lib/x-transaction-id-cubic.ts': { branches: 95, functions: 100, lines: 98, statements: 98 },
        'src/lib/twitter-post-error.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'src/lib/twitter-api-shared.ts': { branches: 80, functions: 55, lines: 70, statements: 65 },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
