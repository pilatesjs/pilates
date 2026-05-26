import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    include: [
      'packages/*/src/**/*.test.{ts,tsx}',
      'packages/*/test/**/*.test.{ts,tsx}',
      'e2e/**/*.test.{ts,tsx}',
      'bench/**/*.test.{ts,tsx}',
      'tools/**/*.test.{ts,tsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['packages/*/src/**'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.bench.{ts,tsx}',
        '**/tables.ts',
        'packages/*/src/index.ts',
        'packages/*/src/types.ts',
        'packages/*/src/**/types.ts',
        'packages/react/src/reconciler.ts',
        'bench/**',
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 75,
        statements: 85,
        // Per-package thresholds set 2 points below the current actual.
        // This locks in the coverage gains from the public-API tests
        // added in May 2026; a future regression that drops a package
        // below its floor fails CI. Bump again as coverage climbs.
        'packages/core/src/**': { lines: 95, functions: 96, branches: 93, statements: 95 },
        'packages/diff/src/**': { lines: 98, functions: 98, branches: 95, statements: 98 },
        'packages/render/src/**': { lines: 90, functions: 93, branches: 82, statements: 90 },
        'packages/react/src/**': { lines: 85, functions: 85, branches: 76, statements: 85 },
        'packages/widgets/src/**': { lines: 90, functions: 97, branches: 86, statements: 90 },
      },
    },
  },
});
