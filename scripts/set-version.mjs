// Sets or checks the version of one package. The app and the extension
// have their own versions. A release tag must equal the app version.
//
//   node scripts/set-version.mjs app 0.2.0              the app, its crates, and the Tauri config
//   node scripts/set-version.mjs extension 0.1.1        the manifest and the extension package
//   node scripts/set-version.mjs --check app 0.2.0      exit 1 where it differs
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The first match in each file is the version of the package itself.
const json = /("version": ")[^"]*(")/
export const FILES = {
  app: [
    ['app/package.json', json],
    ['app/src-tauri/tauri.conf.json', json],
    ['app/Cargo.toml', /(^version = ")[^"]*(")/m],
  ],
  extension: [
    ['extension/manifest.json', json],
    ['extension/package.json', json],
  ],
}

// The arguments, or null when they do not read.
export function parseArgs(args) {
  const check = args[0] === '--check'
  const [target, version, ...rest] = check ? args.slice(1) : args
  if (!FILES[target] || !/^\d+\.\d+\.\d+$/.test(version ?? '') || rest.length) return null
  return { check, target, version }
}

// The version in a file text, and the text with the new version.
export function replaceVersion(text, pattern, version) {
  const match = text.match(pattern)
  if (!match) throw new Error('no version field')
  const current = text.slice(match.index + match[1].length, match.index + match[0].length - match[2].length)
  return { current, text: text.replace(pattern, `$1${version}$2`) }
}

function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed) {
    console.error('usage: node scripts/set-version.mjs [--check] app|extension <major.minor.patch>')
    process.exit(2)
  }
  const { check, target, version } = parsed
  const root = fileURLToPath(new URL('..', import.meta.url))
  let wrong = 0
  for (const [path, pattern] of FILES[target]) {
    const { current, text } = replaceVersion(readFileSync(root + path, 'utf8'), pattern, version)
    if (current === version) continue
    if (check) {
      console.error(`${path}: ${current}, expected ${version}`)
      wrong++
    } else {
      writeFileSync(root + path, text)
      console.log(`${path}: ${current} -> ${version}`)
    }
  }
  if (check) process.exit(wrong ? 1 : 0)
  // Cargo.lock lists the workspace crates with their version.
  if (target === 'app') {
    execFileSync('cargo', ['update', '--workspace', '--offline'], { cwd: root + 'app', stdio: 'inherit' })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
