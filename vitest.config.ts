import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
        alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'lib'),
      '@lib': resolve(__dirname, 'src/lib'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
});