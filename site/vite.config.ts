import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { releasesPlugin } from './plugin.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), releasesPlugin(new URL('./releases.json', import.meta.url))],
  server: { port: 5198 },
})
