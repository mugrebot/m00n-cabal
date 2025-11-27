import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', '**/e2e/**']
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './')
    }
  }
});
