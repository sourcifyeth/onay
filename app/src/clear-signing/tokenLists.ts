// The token lists the user chose. A listed address renders with the
// bundled template of the ERC-20 standard. A list is a claim of its
// publisher, not checked here, so the page marks what comes from it as
// third-party data. The lists are saved in the webview with the last
// good copy of each. The pure parts have no browser calls, so the tests
// run them.

import type { Fetch } from '../gates/gate.ts'
import type { Hex } from '../messages.ts'

const STORAGE_KEY = 'onay.tokenLists'

// The format of a list: the Uniswap Token Lists schema.
export const SCHEMA_URL = 'https://github.com/Uniswap/token-lists/blob/main/src/tokenlist.schema.json'

// The list that ships with the app. See the settings page for the reason.
export const DEFAULT_LIST_URL = 'https://tokens.uniswap.org'

// A list refreshes after this time.
export const REFRESH_AFTER = 24 * 60 * 60 * 1000

export const MAX_BYTES = 8 * 1024 * 1024
export const MAX_TOKENS = 10_000

export type Version = { major: number; minor: number; patch: number }

export type Token = { chainId: number; address: Hex; symbol: string; decimals: number }

// A list, with the fields the page uses. Addresses are in lowercase.
export type TokenList = {
  name: string
  version: Version
  timestamp: string
  tokens: Token[]
}

export type ListEntry = {
  url: string
  // The last accepted copy. Null until the first fetch succeeded.
  list: TokenList | null
  // A fetched copy that waits for the user: its major version went up,
  // or its version went down.
  held: TokenList | null
  fetchedAt: number | null
  error: string | null
}

export function isHttpsUrl(value: string): boolean {
  if (!/^https:\/\/\S+$/.test(value)) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isAddress(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function asVersion(value: unknown): Version | null {
  const record = value as Record<string, unknown> | null
  if (typeof record !== 'object' || record === null) return null
  const { major, minor, patch } = record
  return isCount(major) && isCount(minor) && isCount(patch) ? { major, minor, patch } : null
}

export function versionText(version: Version): string {
  return `v${version.major}.${version.minor}.${version.patch}`
}

export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

// The list as parsed, with the count of entries that were skipped: a
// non-EVM address, a bad chain id, or bad decimals. Throws if the list
// has the wrong shape.
export function parseTokenList(value: unknown): { list: TokenList; skipped: number } {
  const record = value as Record<string, unknown> | null
  if (typeof record !== 'object' || record === null || Array.isArray(record)) throw new Error('not a JSON object')
  if (typeof record.name !== 'string' || record.name.trim() === '') throw new Error('the list has no name')
  const version = asVersion(record.version)
  if (!version) throw new Error('the list has no version')
  if (!Array.isArray(record.tokens)) throw new Error('the list has no tokens array')
  if (record.tokens.length > MAX_TOKENS) throw new Error(`the list has more than ${MAX_TOKENS} tokens`)
  const tokens: Token[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const item of record.tokens) {
    const token = item as Record<string, unknown> | null
    if (typeof token !== 'object' || token === null) throw new Error('a token is not an object')
    const { chainId, address, decimals, symbol } = token
    if (!isCount(chainId) || chainId === 0 || !isAddress(address) || !isCount(decimals) || decimals > 255) {
      skipped += 1
      continue
    }
    const key = `${chainId}:${address.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    tokens.push({
      chainId,
      address: address.toLowerCase() as Hex,
      symbol: typeof symbol === 'string' ? symbol.slice(0, 20) : '',
      decimals,
    })
  }
  const timestamp = typeof record.timestamp === 'string' ? record.timestamp : ''
  return { list: { name: record.name.trim().slice(0, 60), version, timestamp, tokens }, skipped }
}

const TOO_BIG = `the list is over ${MAX_BYTES / 1024 / 1024} MB`

// The body as text, read in chunks and stopped at the cap, so that a
// list cannot fill the memory before the check.
async function readCapped(response: Response, cap: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    if (new TextEncoder().encode(text).length > cap) throw new Error(TOO_BIG)
    return text
  }
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > cap) {
      await reader.cancel()
      throw new Error(TOO_BIG)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return new TextDecoder().decode(bytes)
}

// Fetches and parses a list. Rejects a body over the size cap.
export async function fetchTokenList(
  url: string,
  fetch: Fetch,
  timeout = 15_000,
): Promise<{ list: TokenList; skipped: number }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length'))
  if (length > MAX_BYTES) throw new Error(TOO_BIG)
  const text = await readCapped(response, MAX_BYTES)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error('not JSON')
  }
  return parseTokenList(body)
}

// Whether a fetched list replaces the accepted one at once. A major bump
// means tokens were removed or changed, and a version that goes down is
// not an update: both wait for the user.
export function applies(current: TokenList | null, next: TokenList): boolean {
  if (!current) return true
  const order = compareVersions(next.version, current.version)
  return order >= 0 && next.version.major === current.version.major
}

// The entry after a fetch.
export function withFetched(entry: ListEntry, next: TokenList, now: number): ListEntry {
  if (applies(entry.list, next)) return { ...entry, list: next, held: null, fetchedAt: now, error: null }
  const same = entry.list && compareVersions(entry.list.version, next.version) === 0
  return { ...entry, held: same ? null : next, fetchedAt: now, error: null }
}

// A failed fetch keeps the time of the last good one, so that the list
// counts as stale and is tried again at the next start.
export function withError(entry: ListEntry, error: string): ListEntry {
  return { ...entry, error }
}

export function withAccepted(entry: ListEntry): ListEntry {
  return entry.held ? { ...entry, list: entry.held, held: null } : entry
}

export function isStale(entry: ListEntry, now: number): boolean {
  return entry.fetchedAt === null || now - entry.fetchedAt >= REFRESH_AFTER
}

export function newEntry(url: string): ListEntry {
  return { url, list: null, held: null, fetchedAt: null, error: null }
}

// The addresses on one chain that at least one accepted list holds,
// each with the names of the lists.
export function listedOn(entries: ListEntry[], chainId: number): Map<Hex, string[]> {
  const listed = new Map<Hex, string[]>()
  for (const entry of entries) {
    if (!entry.list) continue
    for (const token of entry.list.tokens) {
      if (token.chainId !== chainId) continue
      const names = listed.get(token.address) ?? []
      if (!names.includes(entry.list.name)) names.push(entry.list.name)
      listed.set(token.address, names)
    }
  }
  return listed
}

// The chains a list covers, and how many tokens it holds.
export function summary(list: TokenList): { tokens: number; chains: number } {
  return { tokens: list.tokens.length, chains: new Set(list.tokens.map((token) => token.chainId)).size }
}

// The saved entries. Null if nothing was saved: the default then applies.
export function parseEntries(value: unknown): ListEntry[] | null {
  if (!Array.isArray(value)) return null
  const entries: ListEntry[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const record = item as Record<string, unknown> | null
    if (typeof record !== 'object' || record === null) continue
    if (typeof record.url !== 'string' || !isHttpsUrl(record.url) || seen.has(record.url)) continue
    seen.add(record.url)
    const list = asList(record.list)
    const held = asList(record.held)
    entries.push({
      url: record.url,
      list,
      held,
      fetchedAt: isCount(record.fetchedAt) ? record.fetchedAt : null,
      error: typeof record.error === 'string' ? record.error : null,
    })
  }
  return entries
}

function asList(value: unknown): TokenList | null {
  if (value === null || value === undefined) return null
  try {
    return parseTokenList(value).list
  } catch {
    return null
  }
}

let entries = load()
const listeners = new Set<() => void>()

export const tokenListStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: () => entries,
}

function save(next: ListEntry[]) {
  entries = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // The change stays until the app closes.
  }
  for (const listener of listeners) listener()
}

function load(): ListEntry[] {
  try {
    return parseEntries(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')) ?? [newEntry(DEFAULT_LIST_URL)]
  } catch {
    return [newEntry(DEFAULT_LIST_URL)]
  }
}

function update(url: string, change: (entry: ListEntry) => ListEntry) {
  save(entries.map((entry) => (entry.url === url ? change(entry) : entry)))
}

// The fetches that run now, so that a list is fetched once at a time.
const running = new Map<string, Promise<void>>()

export function refreshTokenList(url: string): Promise<void> {
  let run = running.get(url)
  if (run) return run
  run = fetchTokenList(url, fetch)
    .then(({ list }) => update(url, (entry) => withFetched(entry, list, Date.now())))
    .catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error)
      update(url, (entry) => withError(entry, text))
    })
    .finally(() => running.delete(url))
  running.set(url, run)
  return run
}

// Fetches each list that is older than a day. Call it once at start.
export function refreshStaleTokenLists(): Promise<void[]> {
  const now = Date.now()
  return Promise.all(entries.filter((entry) => isStale(entry, now)).map((entry) => refreshTokenList(entry.url)))
}

// Adds a list and fetches it. Null if the URL is not https or is in the
// list already.
export function addTokenList(value: string): Promise<void> | null {
  const url = value.trim()
  if (!isHttpsUrl(url) || entries.some((entry) => entry.url === url)) return null
  save([...entries, newEntry(url)])
  return refreshTokenList(url)
}

export function removeTokenList(url: string) {
  save(entries.filter((entry) => entry.url !== url))
}

export function acceptTokenListUpdate(url: string) {
  update(url, withAccepted)
}
