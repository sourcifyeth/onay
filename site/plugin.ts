import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { fillPage, parseReleases } from './src/releases.ts'

// Fills index.html with the releases in releases.json, which releases.mjs writes.
export function releasesPlugin(path: URL): Plugin {
  return {
    name: 'onay-releases',
    transformIndexHtml(html) {
      return fillPage(html, parseReleases(JSON.parse(readFileSync(path, 'utf8'))))
    },
  }
}
