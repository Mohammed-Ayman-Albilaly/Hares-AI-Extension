import { defineConfig } from 'vitest/config';

/** Model evaluations: slow, download models, never part of `npm test`. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['eval/**/*.eval.ts'],
    testTimeout: 30 * 60_000,
  },
});
