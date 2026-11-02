// The check for a new release of the app on GitHub. The pure parts
// have no browser calls, so the tests run them.

import type { Fetch } from './gates/gate.ts'
import { readCapped } from './clear-signing/tokenLists.ts'

export const RELEASES_API = 'https://api.github.com/repos/sourcifyeth/onay/releases?per_page=30'

// The page where the user gets the app.
export const DOWNLOAD_PAGE = 'https://onay.sh/'

// The app checks again after this time.
export const CHECK_EVERY = 24 * 60 * 60 * 1000

export const MAX_BYTES = 2 * 1024 * 1024

// The tag of an app release. The extension has its own tags, such as extension-0.1.1.
const APP_TAG = /^(\d+)\.(\d+)\.(\d+)$/

export type Semver = [number, number, number]

// The version in a tag or in the app, or null if it is not major.minor.patch.
export function parseVersion(text: string): Semver | null {
  const match = APP_TAG.exec(text)
  if (!match) return null
  const version = match.slice(1).map(Number) as Semver
  return version.every(Number.isSafeInteger) ? version : null
}

export function compareSemver(a: Semver, b: Semver): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

// The highest published app version in the answer of the GitHub API.
// Drafts, prereleases and extension tags do not count.
export function latestAppVersion(data: unknown): string | null {
  if (!Array.isArray(data)) throw new Error('not a list of releases')
  let latest: { tag: string; version: Semver } | null = null
  for (const item of data) {
    const record = item as Record<string, unknown> | null
    if (typeof record !== 'object' || record === null) continue
    if (record.draft !== false || record.prerelease !== false || typeof record.tag_name !== 'string') continue
    const version = parseVersion(record.tag_name)
    if (version && (!latest || compareSemver(version, latest.version) > 0)) {
      latest = { tag: record.tag_name, version }
    }
  }
  return latest?.tag ?? null
}

// The newer version, or null if the app runs the latest one.
export function newerVersion(current: string, latest: string | null): string | null {
  const running = parseVersion(current)
  const released = latest === null ? null : parseVersion(latest)
  if (!running || !released) return null
  return compareSemver(released, running) > 0 ? latest : null
}

// Asks GitHub for the releases. Returns the highest app version, or null if there is none.
export async function fetchLatestVersion(fetch: Fetch, timeout = 15_000): Promise<string | null> {
  const response = await fetch(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(timeout),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = await readCapped(response, MAX_BYTES, 'the release list')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error('not JSON')
  }
  return latestAppVersion(body)
}
