import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}', 'packages/*/test/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['packages/*/src/**'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/tables.ts',
        'packages/*/src/index.ts',
        'packages/*/src/types.ts',
        'packages/*/src/**/types.ts',
        'packages/react/src/reconciler.ts',
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 75,
        statements: 85,
        'packages/core/src/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
        'packages/diff/src/**': { lines: 95, functions: 90, branches: 90, statements: 95 },
        'packages/render/src/**': { lines: 80, functions: 80, branches: 65, statements: 80 },
        'packages/react/src/**': { lines: 78, functions: 75, branches: 65, statements: 78 },
        'packages/widgets/src/**': { lines: 90, functions: 85, branches: 82, statements: 90 },
      },
    },
  },
});
