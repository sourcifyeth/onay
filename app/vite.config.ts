import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Tauri starts this dev server and loads it in the webview.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri prints its own output. Do not clear it.
  clearScreen: false,
  server: {
    // Fixed port: tauri.conf.json points to it.
    port: 1420,
    strictPort: true,
    watch: {
      // Cargo rebuilds the Rust side. Vite must not watch it.
      ignored: ['**/src-tauri/**', '**/relay/**', '**/target/**'],
    },
  },
})
