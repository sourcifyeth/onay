// The check for a new release of the app on GitHub. The pure parts
// have no browser calls, so the tests run them.

import { readCapped, type Fetch } from './gates/gate.ts'
import { compareVersions, type Version } from './version.ts'

// 100 releases, as the download page reads: app and extension releases share one list.
export const RELEASES_API = 'https://api.github.com/repos/sourcifyeth/onay/releases?per_page=100'

// The page where the user gets the app.
export const DOWNLOAD_PAGE = 'https://onay.sh/'

export const MAX_BYTES = 2 * 1024 * 1024

// The tag of an app release. The extension has its own tags, such as extension-0.1.1.
const APP_TAG = /^(\d+)\.(\d+)\.(\d+)$/

// The version in a tag or in the app, or null if it is not major.minor.patch.
export function parseVersion(text: string): Version | null {
  const match = APP_TAG.exec(text)
  if (!match) return null
  const [major, minor, patch] = match.slice(1).map(Number)
  return [major, minor, patch].every(Number.isSafeInteger) ? { major, minor, patch } : null
}

// The highest published app version in the answer of the GitHub API.
// Drafts, prereleases and extension tags do not count.
export function latestAppVersion(data: unknown): string | null {
  if (!Array.isArray(data)) throw new Error('not a list of releases')
  let latest: { tag: string; version: Version } | null = null
  for (const item of data) {
    const record = item as Record<string, unknown> | null
    if (typeof record !== 'object' || record === null) continue
    if (record.draft !== false || record.prerelease !== false || typeof record.tag_name !== 'string') continue
    const version = parseVersion(record.tag_name)
    if (version && (!latest || compareVersions(version, latest.version) > 0)) {
      latest = { tag: record.tag_name, version }
    }
  }
  return latest?.tag ?? null
}

// How the app version stands against the latest release on GitHub.
// "ahead" is a build above every release, such as a development build.
export type ReleaseStatus = 'newer' | 'latest' | 'ahead' | 'none'

export function releaseStatus(current: string, latest: string | null): ReleaseStatus {
  const running = parseVersion(current)
  const released = latest === null ? null : parseVersion(latest)
  if (!released) return 'none'
  if (!running) return 'ahead'
  const order = compareVersions(released, running)
  return order > 0 ? 'newer' : order === 0 ? 'latest' : 'ahead'
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
