import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { fillPage, fromGitHub } from './src/releases.ts'

// Fills index.html with the releases in releases.json: the answer of the GitHub API, which releases.mjs writes.
export function releasesPlugin(path: URL): Plugin {
  return {
    name: 'onay-releases',
    transformIndexHtml(html) {
      return fillPage(html, fromGitHub(JSON.parse(readFileSync(path, 'utf8'))))
    },
  }
}
