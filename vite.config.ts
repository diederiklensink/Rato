import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

const pagesBasePath = process.env.VITE_BASE_PATH
const base = pagesBasePath ? `${pagesBasePath.replace(/\/+$/, '')}/` : '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 10_000,
  },
})
