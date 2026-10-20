import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@mini': fileURLToPath(new URL('./mini-vue', import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ['mini-vue/**/*.test.ts', 'chapters/**/*.test.ts'],
    environment: 'node',
  },
})
