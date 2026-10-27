// What the block explorers claim about the source code of a contract:
// Etherscan and Blockscout. Each answer is a claim of the explorer, not
// checked here. This module takes `fetch` as a parameter, so the tests
// run it as it is.

import type { ChainConfig } from '../chainList.ts'
import { readCapped } from '../clear-signing/tokenLists.ts'
import { errorText, type Fetch } from '../gates/gate.ts'
import type { Hex } from '../messages.ts'

export type Explorer = 'etherscan' | 'blockscout'

export const EXPLORER_NAMES: Record<Explorer, string> = { etherscan: 'Etherscan', blockscout: 'Blockscout' }

export type ExplorerHosts = { etherscan: string; blockscout: string; blockscoutApi?: string }

// The explorers of the chains that Onay knows, by chain id. A chain that
// the user adds with one of these ids gets its hosts.
export const EXPLORER_HOSTS: Record<number, ExplorerHosts> = {
  1: { etherscan: 'https://etherscan.io', blockscout: 'https://eth.blockscout.com' },
  11155111: { etherscan: 'https://sepolia.etherscan.io', blockscout: 'https://eth-sepolia.blockscout.com' },
  560048: { etherscan: 'https://hoodi.etherscan.io', blockscout: 'https://eth-hoodi.blockscout.com' },
  42161: { etherscan: 'https://arbiscan.io', blockscout: 'https://arbitrum.blockscout.com' },
  10: { etherscan: 'https://optimistic.etherscan.io', blockscout: 'https://explorer.optimism.io' },
  8453: { etherscan: 'https://basescan.org', blockscout: 'https://base.blockscout.com' },
  59144: {
    etherscan: 'https://lineascan.build',
    blockscout: 'https://explorer.linea.build',
    blockscoutApi: 'https://api-explorer.linea.build',
  },
}

export const ETHERSCAN_API = 'https://api.etherscan.io/v2/api'
export const SOURCIFY_REPO = 'https://repo.sourcify.dev'

const TIMEOUT = 15_000
// The cap of one answer of an explorer or of GoPlus.
export const MAX_ANSWER = 2 * 1024 * 1024

// The explorers of one chain. Null where no explorer covers the chain.
export type ChainExplorers = { etherscan: string | null; blockscout: string | null; blockscoutApi: string | null }

const trimmed = (url: string) => url.trim().replace(/\/+$/, '')

// A field of the chain config wins over the table. An empty field means
// that the user turned that explorer off.
function pick(field: string | undefined, fallback: string | undefined): string | null {
  if (field === undefined) return fallback ?? null
  return field.trim() === '' ? null : trimmed(field)
}

export function explorersOf(chain: ChainConfig): ChainExplorers {
  const table = EXPLORER_HOSTS[chain.id] as ExplorerHosts | undefined
  const etherscan = pick(chain.etherscan, table?.etherscan)
  const blockscout = pick(chain.blockscout, table?.blockscout)
  let blockscoutApi: string | null = null
  if (blockscout !== null) {
    if (chain.blockscoutApi !== undefined && chain.blockscoutApi.trim() !== '')
      blockscoutApi = trimmed(chain.blockscoutApi)
    // An own instance serves its API on its own host.
    else if (blockscout === table?.blockscout) blockscoutApi = table.blockscoutApi ?? blockscout
    else blockscoutApi = blockscout
  }
  return { etherscan, blockscout, blockscoutApi }
}

export const etherscanLink = (host: string, address: Hex) => `${host}/address/${address}#code`
export const blockscoutLink = (host: string, address: Hex) => `${host}/address/${address}?tab=contract`
export const sourcifyLink = (chainId: number, address: Hex) => `${SOURCIFY_REPO}/${chainId}/${address}`

// The sites that the app opens. Keep it the same as ALLOWED in
// src-tauri/src/browser.rs. A custom host gets no link.
const LINK_HOSTS = [
  SOURCIFY_REPO,
  ...Object.values(EXPLORER_HOSTS).flatMap((hosts) => [hosts.etherscan, hosts.blockscout]),
].map((host) => `${host}/`)

export function linkable(url: string): boolean {
  return LINK_HOSTS.some((host) => url.startsWith(host))
}

// What an explorer says about the source code of a contract.
export type ExplorerStatus =
  | { kind: 'verified'; name: string | null; partial: boolean }
  | { kind: 'not verified' }
  // No answer that says either. `limited` is set when the explorer
  // refused for its rate limit.
  | { kind: 'unknown'; reason: string; limited?: boolean }
  // Etherscan needs a key, and the user gave none. No request went out.
  | { kind: 'no key' }

export const RATE_LIMITED: ExplorerStatus = { kind: 'unknown', reason: 'rate limited', limited: true }

export function statusText(status: ExplorerStatus): string {
  switch (status.kind) {
    case 'verified':
      return `verified${status.name ? ` · ${status.name}` : ''}${status.partial ? ' · partial match' : ''}`
    case 'not verified':
      return 'not verified'
    case 'unknown':
      return `unknown · ${status.reason}`
    case 'no key':
      return 'no API key · not asked'
  }
}

export const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const nameOf = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 80) : null)

// The error texts of Etherscan, in short words. Etherscan answers each
// error with HTTP 200, `status: "0"` and the text as the result.
export function etherscanError(text: string): ExplorerStatus {
  if (/rate limit/i.test(text)) return RATE_LIMITED
  if (/api key/i.test(text)) return { kind: 'unknown', reason: 'the API key is missing or not valid' }
  if (/not supported for this chain/i.test(text)) return { kind: 'unknown', reason: 'this chain needs a paid plan' }
  return { kind: 'unknown', reason: text.slice(0, 120) }
}

// The answer of `getsourcecode`. Only an empty source together with the
// text that Etherscan gives for it counts as not verified.
export function parseEtherscanAnswer(body: unknown): ExplorerStatus {
  const answer = record(body)
  if (!answer) return { kind: 'unknown', reason: 'an answer that does not read' }
  const { result } = answer
  if (typeof result === 'string') return etherscanError(result)
  const first = Array.isArray(result) ? record(result[0]) : null
  if (answer.status !== '1' || !first || typeof first.SourceCode !== 'string') {
    return { kind: 'unknown', reason: 'an answer that does not read' }
  }
  if (first.SourceCode !== '') return { kind: 'verified', name: nameOf(first.ContractName), partial: false }
  if (first.ABI === 'Contract source code not verified') return { kind: 'not verified' }
  return { kind: 'unknown', reason: 'an answer that does not read' }
}

// The answer of `GET /api/v2/smart-contracts/{address}` with HTTP 200.
// Checked on 2026-10-27: a contract without sources gives HTTP 200 with
// the bytecode and no `is_verified` field, and an address without code
// gives HTTP 404 with `{"message":"Not found"}`. Both mean not verified,
// as does `is_verified: false`.
export function parseBlockscoutContract(body: unknown): ExplorerStatus {
  const answer = record(body)
  if (!answer) return { kind: 'unknown', reason: 'an answer that does not read' }
  if (answer.is_verified === true) {
    const partial = answer.is_partially_verified === true && answer.is_fully_verified !== true
    return { kind: 'verified', name: nameOf(answer.name), partial }
  }
  if (answer.is_verified === false) return { kind: 'not verified' }
  if (
    (answer.is_verified === undefined || answer.is_verified === null) &&
    typeof answer.deployed_bytecode === 'string'
  ) {
    return { kind: 'not verified' }
  }
  return { kind: 'unknown', reason: 'an answer that does not read' }
}

// The answer of a lookup: a value, or why there is none. `limited` is
// set when the source refused for its rate limit.
export type Lookup<T> = { ok: true; value: T } | { ok: false; reason: string; limited?: boolean }

export const notRead = (reason: string): Lookup<never> => ({ ok: false, reason })

export type JsonAnswer = { ok: true; status: number; body: unknown } | { ok: false; reason: string; limited?: boolean }

const timedOut = (error: unknown) =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')

// Runs the request and gives the status and the body as JSON. The body
// is undefined when it is not JSON. The timer starts with the request.
// Never throws.
export async function fetchJson(url: string, fetch: Fetch, timeout = TIMEOUT): Promise<JsonAnswer> {
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
  } catch (error) {
    if (timedOut(error)) return { ok: false, reason: 'no answer in time' }
    return { ok: false, reason: `network error · ${errorText(error)}` }
  }
  if (response.status === 429) return { ok: false, reason: 'rate limited', limited: true }
  let text: string
  try {
    text = await readCapped(response, MAX_ANSWER, 'the answer')
  } catch (error) {
    return { ok: false, reason: timedOut(error) ? 'no answer in time' : errorText(error) }
  }
  let body: unknown = undefined
  try {
    body = JSON.parse(text)
  } catch {
    // The caller reads the status.
  }
  return { ok: true, status: response.status, body }
}

// Runs the request and gives the status that the answer or the failure
// gives. Never throws.
async function getJson(
  url: string,
  fetch: Fetch,
  read: (status: number, body: unknown) => ExplorerStatus,
): Promise<ExplorerStatus> {
  const answer = await fetchJson(url, fetch)
  if (!answer.ok) return answer.limited ? RATE_LIMITED : { kind: 'unknown', reason: answer.reason }
  return read(answer.status, answer.body)
}

export function etherscanUrl(chainId: number, address: Hex, key: string): string {
  const query = new URLSearchParams({
    chainid: String(chainId),
    module: 'contract',
    action: 'getsourcecode',
    address,
    apikey: key,
  })
  return `${ETHERSCAN_API}?${query}`
}

// Without a key, no request goes out.
export function etherscanSource(chainId: number, address: Hex, key: string, fetch: Fetch): Promise<ExplorerStatus> {
  if (key.trim() === '') return Promise.resolve({ kind: 'no key' })
  return getJson(etherscanUrl(chainId, address, key.trim()), fetch, (status, body) => {
    if (status !== 200) return { kind: 'unknown', reason: `HTTP ${status}` }
    if (body === undefined) return { kind: 'unknown', reason: 'an answer that is not JSON' }
    return parseEtherscanAnswer(body)
  })
}

export const blockscoutUrl = (api: string, address: Hex) => `${trimmed(api)}/api/v2/smart-contracts/${address}`

export function blockscoutContract(api: string, address: Hex, fetch: Fetch): Promise<ExplorerStatus> {
  return getJson(blockscoutUrl(api, address), fetch, (status, body) => {
    // A 404 from a proxy or a wrong path has a different body.
    if (status === 404)
      return record(body)?.message === 'Not found' ? { kind: 'not verified' } : { kind: 'unknown', reason: 'HTTP 404' }
    if (status === 403) return { kind: 'unknown', reason: 'the instance refused the request' }
    if (status !== 200) return { kind: 'unknown', reason: `HTTP ${status}` }
    if (body === undefined) return { kind: 'unknown', reason: 'an answer that is not JSON' }
    return parseBlockscoutContract(body)
  })
}
