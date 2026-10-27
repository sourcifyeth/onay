// The address lists of the profile: allow lists that name a known
// contract, and block lists that name a sanctioned or scam address. Each
// list is a claim of its publisher, not checked here. The lists are open
// data in public Git repositories. The store fetches each one once a day,
// keeps the last good copy, and saves only the parsed entries. The parts
// take the storage and `fetch` as parameters, so the tests run them.

import type { RegistryIndex } from '@ethereum-sourcify/clear-signing'
import { listedOn, readCapped, type ListEntry } from '../clear-signing/tokenLists.ts'
import type { Fetch } from '../gates/gate.ts'
import type { Hex } from '../messages.ts'

export const STORAGE_KEY = 'onay.addressLists'

export const REFRESH_AFTER = 24 * 60 * 60 * 1000

// The cap of one file. The largest today is 121 kB.
export const MAX_BYTES = 4 * 1024 * 1024
// The cap of the entries of one source.
export const MAX_ENTRIES = 50_000

const TIMEOUT = 20_000

export type ListKind = 'allow' | 'block'

export type SourceId = 'safe' | 'uniswap' | 'ofac' | 'scamsniffer'

// Null `chainId`: the address is on the list on every chain.
export type Entry = { chainId: number | null; address: Hex; label: string }

// A file for one chain only. HTTP 404 means that the source has no file
// for that chain.
export type ListFile = { url: string; chainId?: number }

export type ListSource = {
  id: SourceId
  name: string
  kind: ListKind
  license: string
  // What the settings say about the source, if anything.
  note: string | null
  repository: string
  // True for a source with a file or an entry for each chain.
  perChain: boolean
  // The files of the chains in the settings.
  files(chainIds: number[]): ListFile[]
  // Throws when the file has the wrong shape.
  parse(body: unknown, file: ListFile, chainIds: number[]): Entry[]
}

const isAddress = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)

const asRecord = (value: unknown, what: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${what} is not an object`)
  return value as Record<string, unknown>
}

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null

const SAFE_RAW = 'https://raw.githubusercontent.com/safe-global/safe-deployments/main/src/assets'

// The core contracts of each version. v1.3.0 has other file names.
export const SAFE_FILES = [
  ...[
    'gnosis_safe',
    'gnosis_safe_l2',
    'proxy_factory',
    'multi_send',
    'multi_send_call_only',
    'compatibility_fallback_handler',
  ].map((name) => `v1.3.0/${name}.json`),
  ...['v1.4.1', 'v1.5.0'].flatMap((version) =>
    [
      'safe',
      'safe_l2',
      'safe_proxy_factory',
      'multi_send',
      'multi_send_call_only',
      'compatibility_fallback_handler',
    ].map((name) => `${version}/${name}.json`),
  ),
]

// A Safe deployment file. `networkAddresses` names a deployment type, or
// a list of types, for each chain. The ABI is not read.
export function parseSafe(body: unknown, _file: ListFile, chainIds: number[]): Entry[] {
  const file = asRecord(body, 'the file')
  const name = text(file.contractName, 40)
  const version = text(file.version, 20)
  if (!name || !version) throw new Error('the file has no contract name or version')
  const deployments = asRecord(file.deployments, 'deployments')
  const networks = asRecord(file.networkAddresses, 'networkAddresses')
  const entries: Entry[] = []
  for (const chainId of chainIds) {
    const named = networks[String(chainId)]
    const types = typeof named === 'string' ? [named] : Array.isArray(named) ? named : []
    for (const type of types) {
      if (typeof type !== 'string' || !Object.hasOwn(deployments, type)) continue
      const address = (deployments[type] as { address?: unknown } | null)?.address
      if (!isAddress(address)) continue
      entries.push({ chainId, address: address.toLowerCase() as Hex, label: `${name} v${version}` })
    }
  }
  return entries
}

// A Uniswap deployment file of one chain. The contracts of `latest` only.
export function parseUniswap(body: unknown, file: ListFile): Entry[] {
  const deployments = asRecord(body, 'the file')
  if (file.chainId === undefined || deployments.chainId !== String(file.chainId)) {
    throw new Error('the file is for another chain')
  }
  const latest = asRecord(deployments.latest, 'latest')
  const entries: Entry[] = []
  for (const [name, value] of Object.entries(latest)) {
    const address = (value as { address?: unknown } | null)?.address
    if (!isAddress(address)) continue
    entries.push({ chainId: file.chainId, address: address.toLowerCase() as Hex, label: name.slice(0, 60) })
  }
  return entries
}

// A plain array of addresses. Entries that are not EVM addresses, such
// as TRON addresses in the USDT list of OFAC, are skipped.
function parseAddressArray(body: unknown, label: string): Entry[] {
  if (!Array.isArray(body)) throw new Error('the file is not an array')
  return body.filter(isAddress).map((address) => ({ chainId: null, address: address.toLowerCase() as Hex, label }))
}

const OFAC_RAW = 'https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists'
export const OFAC_ASSETS = ['ETH', 'USDC', 'USDT', 'ARB', 'BSC']

export const parseOfac = (body: unknown, file: ListFile) =>
  parseAddressArray(body, `sanctioned · ${/_([A-Z]+)\.json$/.exec(file.url)?.[1] ?? 'list'}`)

export const parseScamSniffer = (body: unknown) => parseAddressArray(body, 'scam address')

export const LIST_SOURCES: ListSource[] = [
  {
    id: 'safe',
    name: 'Safe deployments',
    kind: 'allow',
    license: 'MIT',
    note: null,
    repository: 'https://github.com/safe-global/safe-deployments',
    perChain: true,
    files: () => SAFE_FILES.map((path) => ({ url: `${SAFE_RAW}/${path}` })),
    parse: parseSafe,
  },
  {
    id: 'uniswap',
    name: 'Uniswap deployments',
    kind: 'allow',
    license: 'none stated',
    note: 'the repository names no license',
    repository: 'https://github.com/Uniswap/contracts',
    perChain: true,
    files: (chainIds) =>
      chainIds.map((chainId) => ({
        url: `https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/${chainId}.json`,
        chainId,
      })),
    parse: parseUniswap,
  },
  {
    id: 'ofac',
    name: 'OFAC sanctions',
    kind: 'block',
    license: 'MIT',
    note: 'generated each night from the list of the US Treasury',
    repository: 'https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses',
    perChain: false,
    files: () => OFAC_ASSETS.map((asset) => ({ url: `${OFAC_RAW}/sanctioned_addresses_${asset}.json` })),
    parse: parseOfac,
  },
  {
    id: 'scamsniffer',
    name: 'ScamSniffer',
    kind: 'block',
    license: 'GPL-3.0',
    note: 'the address file is frozen since 2024-02',
    repository: 'https://github.com/scamsniffer/scam-database',
    perChain: false,
    files: () => [{ url: 'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json' }],
    parse: (body) => parseScamSniffer(body),
  },
]

export const sourceOf = (id: SourceId) => LIST_SOURCES.find((source) => source.id === id) as ListSource

// The fetched entries of each file, as one list without duplicates.
// Throws when a file fails, so that the last good copy stays.
export async function fetchSource(source: ListSource, chainIds: number[], fetch: Fetch): Promise<Entry[]> {
  const files = source.files(chainIds)
  const parts = await Promise.all(
    files.map(async (file) => {
      const name = file.url.split('/').slice(-2).join('/')
      const response = await fetch(file.url, { signal: AbortSignal.timeout(TIMEOUT) })
      if (response.status === 404 && file.chainId !== undefined) return []
      if (!response.ok) throw new Error(`${name} · HTTP ${response.status}`)
      if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error(`${name} · over the size cap`)
      const body = await readCapped(response, MAX_BYTES)
      let json: unknown
      try {
        json = JSON.parse(body)
      } catch {
        throw new Error(`${name} · not JSON`)
      }
      try {
        return source.parse(json, file, chainIds)
      } catch (error) {
        throw new Error(`${name} · ${error instanceof Error ? error.message : String(error)}`)
      }
    }),
  )
  const seen = new Set<string>()
  const entries: Entry[] = []
  for (const entry of parts.flat()) {
    const key = `${entry.chainId}:${entry.address}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push(entry)
  }
  if (entries.length > MAX_ENTRIES) throw new Error(`more than ${MAX_ENTRIES} entries`)
  return entries
}

export type ListState = {
  id: SourceId
  enabled: boolean
  // The time of the last good fetch.
  fetchedAt: number | null
  // The chains of the last good fetch, for the sources with a file per
  // chain.
  chains: number[]
  // The error of the last fetch, if it failed.
  error: string | null
  entries: Entry[]
}

export const newState = (id: SourceId): ListState => ({
  id,
  enabled: true,
  fetchedAt: null,
  chains: [],
  error: null,
  entries: [],
})

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function asEntry(value: unknown): Entry | null {
  const entry = value as Partial<Record<keyof Entry, unknown>> | null
  if (typeof entry !== 'object' || entry === null || !isAddress(entry.address)) return null
  const chainId =
    entry.chainId === null ? null : isCount(entry.chainId) && entry.chainId > 0 ? entry.chainId : undefined
  const label = text(entry.label, 80)
  if (chainId === undefined || label === null) return null
  return { chainId, address: entry.address.toLowerCase() as Hex, label }
}

// The saved states, one for each source. A source that is not saved
// gets its defaults; a bad entry is dropped.
export function parseStates(value: unknown): ListState[] {
  const saved = Array.isArray(value) ? value : []
  return LIST_SOURCES.map(({ id }) => {
    const record = saved.find((item) => (item as { id?: unknown } | null)?.id === id) as
      | Record<string, unknown>
      | undefined
    if (!record) return newState(id)
    const entries = Array.isArray(record.entries)
      ? record.entries
          .slice(0, MAX_ENTRIES)
          .map(asEntry)
          .filter((entry) => entry !== null)
      : []
    return {
      id,
      enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
      fetchedAt: isCount(record.fetchedAt) ? record.fetchedAt : null,
      chains: Array.isArray(record.chains) ? record.chains.filter((chain) => isCount(chain)) : [],
      error: typeof record.error === 'string' ? record.error.slice(0, 200) : null,
      entries,
    }
  })
}

const sameChains = (a: number[], b: number[]) =>
  a.length === b.length && [...a].sort((x, y) => x - y).every((chain, i) => chain === [...b].sort((x, y) => x - y)[i])

// A source counts as stale a day after its last good fetch. A source
// with a file for each chain is also stale when the chains in the
// settings changed since then. A failed fetch keeps the time of the last
// good one, so it is tried again.
export function isStale(state: ListState, chainIds: number[], now: number): boolean {
  if (state.fetchedAt === null || now - state.fetchedAt >= REFRESH_AFTER) return true
  return sourceOf(state.id).perChain && !sameChains(state.chains, chainIds)
}

export const withFetched = (state: ListState, entries: Entry[], chains: number[], now: number): ListState => ({
  ...state,
  entries,
  chains: [...chains],
  fetchedAt: now,
  error: null,
})

export const withError = (state: ListState, error: string): ListState => ({ ...state, error })

// A list that knows the address.
export type Hit = {
  list: string
  kind: ListKind
  label: string
  // The web page of the list or of the entry. Null if none.
  link: string | null
}

// An enabled list that gave no answer for the chain, and why.
export type MissingList = { list: string; reason: string }

// The answer of all lists for one address. `hits` empty and `missing`
// empty: every enabled list answered, and none knows the address.
export type ListAnswer = { hits: Hit[]; missing: MissingList[] }

const matches = (entry: { chainId: number | null; address: string }, chainId: number, address: Hex) =>
  (entry.chainId === null || entry.chainId === chainId) && entry.address.toLowerCase() === address.toLowerCase()

// The hits of the enabled sources, case-insensitive. An entry without a
// chain matches on every chain.
export function hitsFor(states: ListState[], chainId: number, address: Hex): Hit[] {
  const hits: Hit[] = []
  for (const state of states) {
    if (!state.enabled) continue
    const source = sourceOf(state.id)
    for (const entry of state.entries) {
      if (!matches(entry, chainId, address)) continue
      if (hits.some((hit) => hit.list === source.name && hit.label === entry.label)) continue
      hits.push({ list: source.name, kind: source.kind, label: entry.label, link: source.repository })
    }
  }
  return hits
}

// The enabled sources without data for the chain: never fetched, a
// failed fetch with no entries, or a fetch without this chain.
export function missingFor(states: ListState[], chainId: number): MissingList[] {
  const missing: MissingList[] = []
  for (const state of states) {
    if (!state.enabled) continue
    const source = sourceOf(state.id)
    let reason: string | null = null
    if (state.fetchedAt === null) reason = state.error ?? 'not fetched yet'
    else if (state.error !== null && state.entries.length === 0) reason = state.error
    else if (source.perChain && !state.chains.includes(chainId)) {
      reason = state.error ?? `not fetched for chain ${chainId}`
    }
    if (reason !== null) missing.push({ list: source.name, reason })
  }
  return missing
}

export const ERC7730_NAME = 'ERC-7730 registry'
export const ERC7730_REPOSITORY = 'https://github.com/ethereum/clear-signing-erc7730-registry'

// The owner of a descriptor is the first folder under `registry/`.
const ownerOf = (path: string) => /^registry\/([^/]+)\//.exec(path)?.[1] ?? null

// The registry index that Clear Signing fetched already. No new fetch.
export function erc7730Hits(index: RegistryIndex, chainId: number, address: Hex): Hit[] {
  const key = `eip155:${chainId}:${address.toLowerCase()}`
  const paths: string[] = []
  const calldata = index.calldataIndex[key]
  if (typeof calldata === 'string') paths.push(calldata)
  for (const entries of Object.values(index.typedDataIndex[key] ?? {})) {
    for (const entry of entries) if (typeof entry.path === 'string') paths.push(entry.path)
  }
  const owners = [...new Set(paths.map(ownerOf).filter((owner) => owner !== null))]
  return owners.map((owner) => ({
    list: ERC7730_NAME,
    kind: 'allow' as const,
    label: owner,
    link: `${ERC7730_REPOSITORY}/tree/master/registry/${owner}`,
  }))
}

// The token lists of the user. No new fetch.
export function tokenListHits(entries: ListEntry[], chainId: number, address: Hex): Hit[] {
  const names = listedOn(entries, chainId).get(address.toLowerCase() as Hex) ?? []
  return names.map((name) => ({
    list: name,
    kind: 'allow' as const,
    label: 'token',
    link: entries.find((entry) => entry.list?.name === name)?.url ?? null,
  }))
}

// The token lists of the user that have no list yet.
export function missingTokenLists(entries: ListEntry[]): MissingList[] {
  return entries
    .filter((entry) => entry.list === null)
    .map((entry) => ({ list: hostOf(entry.url), reason: entry.error ?? 'not fetched yet' }))
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.slice(0, 60)
  }
}

// The missing lists in words, for the log.
export function missingText(missing: MissingList[]): string {
  return missing.map((item) => `${item.list} not loaded: ${item.reason}`).join(' · ')
}

export type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void }

export type AddressListStore = {
  subscribe(listener: () => void): () => void
  getSnapshot(): ListState[]
  refresh(id: SourceId, chainIds: number[]): Promise<void>
  // Fetches each enabled source that is stale. Call it at start.
  refreshStale(chainIds: number[]): Promise<void>
  setEnabled(id: SourceId, enabled: boolean): void
  // Resolves when the fetches that run now end. Each fetch has a timeout.
  settled(): Promise<void>
}

// A store over the given storage and network. A storage that throws
// keeps the states in memory only.
export function createAddressListStore(io: { storage(): Storage; fetch: Fetch; now(): number }): AddressListStore {
  let states: ListState[]
  try {
    states = parseStates(JSON.parse(io.storage().getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    states = parseStates(null)
  }
  const listeners = new Set<() => void>()
  const running = new Map<SourceId, Promise<void>>()

  const save = (next: ListState[]) => {
    states = next
    try {
      io.storage().setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // The change stays until the app closes.
    }
    for (const listener of listeners) listener()
  }
  const update = (id: SourceId, change: (state: ListState) => ListState) =>
    save(states.map((state) => (state.id === id ? change(state) : state)))

  const refresh = (id: SourceId, chainIds: number[]): Promise<void> => {
    let run = running.get(id)
    if (run) return run
    run = fetchSource(sourceOf(id), chainIds, io.fetch)
      .then((entries) => update(id, (state) => withFetched(state, entries, chainIds, io.now())))
      .catch((error: unknown) =>
        update(id, (state) => withError(state, error instanceof Error ? error.message : String(error))),
      )
      .finally(() => running.delete(id))
    running.set(id, run)
    return run
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => states,
    refresh,
    async refreshStale(chainIds) {
      const now = io.now()
      await Promise.all(
        states
          .filter((state) => state.enabled && isStale(state, chainIds, now))
          .map((state) => refresh(state.id, chainIds)),
      )
    },
    setEnabled(id, enabled) {
      update(id, (state) => ({ ...state, enabled }))
    },
    async settled() {
      await Promise.all(running.values())
    },
  }
}

export const addressListStore = createAddressListStore({
  storage: () => localStorage,
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
})
