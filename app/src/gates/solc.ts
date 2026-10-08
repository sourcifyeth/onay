// The Solidity compiler, in a worker of the webview. Each build comes
// from the official list, and runs only if its hash is the one in the
// list. The worker is web-solc. The downloads take `fetch` as a
// parameter, so the tests run them as they are.

import { loadSolc } from 'web-solc'
import type { Fetch, Log } from './gate.ts'

export const SOLC_BIN = 'https://binaries.soliditylang.org/emscripten-wasm32'

const TIMEOUT = 60_000

export type Build = { path: string; longVersion: string; sha256: string }

type Bytes = Uint8Array<ArrayBuffer>

export type Solc = {
  // The source of a build, checked. Cached in the webview.
  soljson(version: string, log: Log): Promise<string>
  // Runs the standard JSON input of a version in a new worker.
  compile(version: string, input: object, log: Log): Promise<object>
}

export function solcFor(fetch: Fetch): Solc {
  let list: Promise<Build[]> | undefined
  const soljsons = new Map<string, Promise<string>>()
  const soljson = (version: string, log: Log) => {
    list ??= fetchList(fetch)
    let source = soljsons.get(version)
    if (!source) {
      source = list
        .then((builds) => fetchSoljson(builds, version, fetch, log))
        .catch((error: unknown) => {
          // The next request tries again.
          soljsons.delete(version)
          throw error
        })
      soljsons.set(version, source)
    }
    return source
  }
  return {
    soljson,
    async compile(version, input, log) {
      const solc = await loadSolc(await soljson(version, log))
      try {
        return await solc.compile(input)
      } finally {
        solc.stopWorker()
      }
    },
  }
}

// The build of a version, as Sourcify names it: "0.8.24+commit.e11b9ed9",
// with or without a "v".
export function pickBuild(builds: Build[], version: string): Build | null {
  const longVersion = version.replace(/^v/, '')
  return builds.find((build) => build.longVersion === longVersion) ?? null
}

async function fetchList(fetch: Fetch): Promise<Build[]> {
  const response = await fetch(`${SOLC_BIN}/list.json`, { signal: AbortSignal.timeout(TIMEOUT) })
  if (!response.ok) throw new Error(`the solc list answered HTTP ${response.status}`)
  return parseList(await response.json())
}

export function parseList(body: unknown): Build[] {
  const builds = (body as { builds?: unknown } | null)?.builds
  if (!Array.isArray(builds)) throw new Error('the solc list has an unexpected shape')
  return builds.map((build: { path?: unknown; longVersion?: unknown; sha256?: unknown }) => {
    const { path, longVersion, sha256 } = build ?? {}
    if (typeof path !== 'string' || typeof longVersion !== 'string' || typeof sha256 !== 'string') {
      throw new Error('the solc list has an unexpected build')
    }
    return { path, longVersion, sha256: sha256.toLowerCase() }
  })
}

async function fetchSoljson(builds: Build[], version: string, fetch: Fetch, log: Log): Promise<string> {
  const build = pickBuild(builds, version)
  if (!build) throw new Error(`solc ${version} is not in the official list`)
  const url = `${SOLC_BIN}/${build.path}`
  const cached = await fromCache(url)
  const bytes = cached ?? (await download(url, fetch, log))
  const digest = await sha256(bytes)
  if (digest !== build.sha256) {
    if (cached) await forget(url)
    throw new Error(`solc ${version}: the file does not match the hash in the official list`)
  }
  log({
    source: 'solc',
    text: `${build.longVersion} · ${cached ? 'from the cache' : 'downloaded'} · sha256 matches the official list`,
    ok: true,
    proof: true,
  })
  if (!cached) await keep(url, bytes)
  return new TextDecoder().decode(bytes)
}

async function download(url: string, fetch: Fetch, log: Log): Promise<Bytes> {
  log({ source: 'solc', text: `downloading ${url.slice(url.lastIndexOf('/') + 1)}` })
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) })
  if (!response.ok) throw new Error(`the solc download answered HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

export async function sha256(bytes: Bytes): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return `0x${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

// The cache of the webview keeps the builds between runs of the app. A
// build is checked again each time it comes out of it.
const CACHE = 'solc'

async function fromCache(url: string): Promise<Bytes | null> {
  try {
    const hit = await (await caches.open(CACHE)).match(url)
    return hit ? new Uint8Array(await hit.arrayBuffer()) : null
  } catch {
    return null
  }
}

async function keep(url: string, bytes: Bytes) {
  try {
    await (await caches.open(CACHE)).put(url, new Response(bytes))
  } catch {
    // Without a cache, the next run downloads again.
  }
}

async function forget(url: string) {
  try {
    await (await caches.open(CACHE)).delete(url)
  } catch {
    // Nothing to forget.
  }
}
