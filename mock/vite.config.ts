import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const root = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  // relative asset paths, so the build also works under github.io/onay/
  base: './',
  plugins: [react(), tailwindcss()],
  // two pages: the whole mock, and the simulation step alone to share
  build: {
    rollupOptions: {
      input: { main: resolve(root, 'index.html'), simulation: resolve(root, 'simulation.html') },
    },
  },
})
