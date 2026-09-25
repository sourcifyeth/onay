import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // relative asset paths, so the build also works under github.io/onay/
  base: './',
  plugins: [react(), tailwindcss()],
})
