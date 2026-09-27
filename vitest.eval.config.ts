import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/eval/**/*.eval.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})
