import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    include: ['bench/harness/**/*.test.ts', 'bench/*.test.ts'],
  },
});
