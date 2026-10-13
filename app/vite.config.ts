import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// lib-sourcify depends on @fairdatasociety/bmt-js, which was published as
// a development build: each of its modules is a string of code inside an
// eval call. Vite cannot see into those strings when it bundles, and the
// code inside them stops working in the webview. This plugin turns each
// string back into plain code before Vite bundles the file.
function unevalBmtJs(): Plugin {
  return {
    name: 'uneval-bmt-js',
    transform(code, id) {
      if (!id.includes('/bmt-js/dist/index.js')) return
      return code.replace(/eval\((["'])((?:[^\\]|\\.)*?)\1\)/g, (_, quote: string, body: string) => {
        const source = new Function(`return ${quote}${body}${quote}`)() as string
        return `\n${source}\n`
      })
    },
  }
}

// Tauri starts this dev server and loads it in the webview.
export default defineConfig({
  plugins: [react(), tailwindcss(), unevalBmtJs()],
  optimizeDeps: { rolldownOptions: { plugins: [unevalBmtJs()] } },
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
