import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

// Per the Next.js 16 testing guide (node_modules/next/dist/docs/.../testing/vitest.md).
// tsconfigPaths wires the `@/*` alias; jsdom is the default env so component tests can be
// colocated later. Pure-logic suites run fine under it too.
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
  },
})
