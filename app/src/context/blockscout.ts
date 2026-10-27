// What Blockscout claims about an address, for the contract profile: the
// creator, the name and the reputation, the ERC-20 tokens it holds, and
// its first transactions. Each answer is a
// claim of the explorer, not checked here. Each part can fail on its own.
// This module takes `fetch` as a parameter, so the tests run it as it is.

import type { Fetch, Log } from '../gates/gate.ts'
import type { Hex } from '../messages.ts'
import { fetchJson, record, type Lookup } from './explorers.ts'

export type BlockscoutAddress = {
  creator: Hex | null
  creationTransaction: Hex | null
  name: string | null
  // True when the instance marks the address as a scam.
  scam: boolean
  isContract: boolean | null
}

export type TokenClaim = {
  token: Hex
  symbol: string | null
  decimals: number | null
  // The amount in the smallest unit of the token.
  value: bigint
}

export type TokenPage = {
  // At most MAX_TOKENS, in the order of the explorer.
  tokens: TokenClaim[]
  // True when the explorer knows more tokens than these.
  more: boolean
}

export type FirstTransaction = {
  hash: Hex
  block: number | null
  // Milliseconds since 1970.
  time: number
}

// The oldest transactions to an address, up to FEW_TRANSACTIONS of them.
// `seen` is how many the pages gave, `more` whether the explorer has more.
export type TransactionPage = {
  first: FirstTransaction | null
  seen: number
  more: boolean
}

// A contract with fewer transactions gets a hint in the review. The
// pages of the explorers stop at this count: the explorers give no
// count that holds for a busy address.
export const FEW_TRANSACTIONS = 100

export type BlockscoutClaims = {
  address: Lookup<BlockscoutAddress>
  tokens: Lookup<TokenPage>
  transactions: Lookup<TransactionPage>
}

export type ClaimPart = keyof BlockscoutClaims

export const PARTS: ClaimPart[] = ['address', 'tokens', 'transactions']

// The profile shows at most this many tokens, and reads the amount of
// each from the chain.
export const MAX_TOKENS = 10

const trimmed = (url: string) => url.trim().replace(/\/+$/, '')

export const addressUrl = (api: string, address: Hex) => `${trimmed(api)}/api/v2/addresses/${address}`
export const tokensUrl = (api: string, address: Hex) => `${addressUrl(api, address)}/tokens?type=ERC-20`
// Checked on 2026-10-27: the first item is the oldest transaction to the
// address, and a page holds 50. `next` is the `next_page_params` of the
// page before, as the query of the next page.
export const transactionsUrl = (api: string, address: Hex, next?: Record<string, string>) =>
  `${addressUrl(api, address)}/transactions?${new URLSearchParams({ filter: 'to', sort: 'block_number', order: 'asc', ...next })}`

const asAddress = (value: unknown): Hex | null =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value.toLowerCase() as Hex) : null

const asHash = (value: unknown): Hex | null =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value) ? (value.toLowerCase() as Hex) : null

const asText = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null

// Blockscout gives counts and amounts as decimal strings.
function asAmount(value: unknown): bigint | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  if (typeof value !== 'string' || !/^[0-9]{1,78}$/.test(value)) return null
  return BigInt(value)
}

function asCount(value: unknown): number | null {
  const amount = asAmount(value)
  return amount !== null && amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null
}

// A field with a bad value is left out, not the whole answer.
export function parseAddress(body: unknown): BlockscoutAddress {
  const answer = record(body)
  if (!answer) throw new Error('an answer that does not read')
  return {
    creator: asAddress(answer.creator_address_hash),
    creationTransaction: asHash(answer.creation_transaction_hash),
    name: asText(answer.name, 80),
    scam: answer.is_scam === true || answer.reputation === 'scam',
    isContract: typeof answer.is_contract === 'boolean' ? answer.is_contract : null,
  }
}

const UNKNOWN_ADDRESS: BlockscoutAddress = {
  creator: null,
  creationTransaction: null,
  name: null,
  scam: false,
  isContract: null,
}

// A token with a bad address or amount is skipped.
export function parseTokens(body: unknown): TokenPage {
  const answer = record(body)
  if (!answer || !Array.isArray(answer.items)) throw new Error('no list of tokens')
  const tokens: TokenClaim[] = []
  for (const item of answer.items) {
    const holding = record(item)
    const token = record(holding?.token)
    const address = asAddress(token?.address_hash)
    const value = asAmount(holding?.value)
    if (!token || !address || value === null || (token.type !== undefined && token.type !== 'ERC-20')) continue
    if (tokens.some((other) => other.token === address)) continue
    const decimals = asCount(token.decimals)
    tokens.push({
      token: address,
      symbol: asText(token.symbol, 20),
      decimals: decimals !== null && decimals <= 255 ? decimals : null,
      value,
    })
  }
  const next = answer.next_page_params
  return {
    tokens: tokens.slice(0, MAX_TOKENS),
    more: tokens.length > MAX_TOKENS || (next !== null && next !== undefined),
  }
}

// One page of transactions, and the query of the next page when there
// is one.
export type ParsedPage = { page: TransactionPage; next: Record<string, string> | null }

export function parseTransactions(body: unknown): ParsedPage {
  const answer = record(body)
  if (!answer || !Array.isArray(answer.items)) throw new Error('no list of transactions')
  const cursor = record(answer.next_page_params)
  const next = cursor
    ? Object.fromEntries(
        Object.entries(cursor)
          .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
          .map(([key, value]) => [key, String(value)]),
      )
    : null
  const seen = answer.items.length
  if (seen === 0) return { page: { first: null, seen, more: next !== null }, next }
  const first = record(answer.items[0])
  const hash = asHash(first?.hash)
  const time = typeof first?.timestamp === 'string' ? Date.parse(first.timestamp) : NaN
  if (!hash || !Number.isFinite(time)) throw new Error('a transaction that does not read')
  return { page: { first: { hash, block: asCount(first?.block_number), time }, seen, more: next !== null }, next }
}

// The count in words: "fewer than 100" when the pages ended, else a
// floor.
export function pageText(page: TransactionPage): string {
  if (page.seen < FEW_TRANSACTIONS && !page.more) return `fewer than ${FEW_TRANSACTIONS}`
  return `${page.seen} or more`
}

// One part: the request, then the parser. HTTP 404 with the text of
// Blockscout means that the explorer does not know the address; the
// part gives `notFound` then.
async function part<T>(
  url: string,
  fetch: Fetch,
  parse: (body: unknown) => T,
  notFound: Lookup<T>,
): Promise<Lookup<T>> {
  const answer = await fetchJson(url, fetch)
  if (!answer.ok) return answer
  if (answer.status === 404 && record(answer.body)?.message === 'Not found') return notFound
  if (answer.status === 403) return { ok: false, reason: 'the instance refused the request' }
  if (answer.status !== 200) return { ok: false, reason: `HTTP ${answer.status}` }
  if (answer.body === undefined) return { ok: false, reason: 'an answer that is not JSON' }
  try {
    return { ok: true, value: parse(answer.body) }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

// The answer for an address that Blockscout does not know. The address
// can be too new for the index, so the session does not keep it.
const found = <T>(value: T): Lookup<T> & { notFound: true } => ({ ok: true, value, notFound: true })

export const isNotFound = (claim: Lookup<unknown>): boolean => 'notFound' in claim

export const blockscoutAddress = (api: string, address: Hex, fetch: Fetch) =>
  part(addressUrl(api, address), fetch, parseAddress, found(UNKNOWN_ADDRESS))
// No count is not a count of 0: the young hint must not fire on it.
export const blockscoutTokens = (api: string, address: Hex, fetch: Fetch) =>
  part(tokensUrl(api, address), fetch, parseTokens, found({ tokens: [], more: false }))
// Up to two pages: enough to say whether the address has fewer than
// FEW_TRANSACTIONS transactions.
export async function blockscoutTransactions(
  api: string,
  address: Hex,
  fetch: Fetch,
): Promise<Lookup<TransactionPage>> {
  const none: ParsedPage = { page: { first: null, seen: 0, more: false }, next: null }
  const one = await part(transactionsUrl(api, address), fetch, parseTransactions, found(none))
  if (!one.ok) return one
  const { page, next } = one.value
  if (isNotFound(one)) return { ...one, value: page }
  if (!next || page.seen >= FEW_TRANSACTIONS) return { ok: true, value: page }
  const two = await part(transactionsUrl(api, address, next), fetch, parseTransactions, found(none))
  if (!two.ok) return two
  const rest = two.value
  return { ok: true, value: { first: page.first, seen: page.seen + rest.page.seen, more: rest.next !== null } }
}

const short = (hex: Hex) => `${hex.slice(0, 6)}…${hex.slice(-4)}`

export const dayText = (time: number) => new Date(time).toISOString().slice(0, 10)

// The log text of one part.
export function claimText<P extends ClaimPart>(part: P, claim: BlockscoutClaims[P]): string {
  if (!claim.ok) return `${PART_NAMES[part]} · not read · ${claim.reason}`
  const value = claim.value
  switch (part) {
    case 'address': {
      const address = value as BlockscoutAddress
      const facts = [
        address.name ? `name ${address.name}` : 'no name',
        address.creator ? `creator ${short(address.creator)}` : null,
        address.creationTransaction ? `creation transaction ${short(address.creationTransaction)}` : null,
        address.scam ? 'marked as scam' : null,
      ]
      return `address · ${facts.filter((fact) => fact !== null).join(' · ')}`
    }
    case 'tokens': {
      const page = value as TokenPage
      return `ERC-20 tokens · ${page.tokens.length}${page.more ? ' and more' : ''}`
    }
    case 'transactions': {
      const page = value as TransactionPage
      if (!page.first) return 'transactions · none'
      return `transactions · ${pageText(page)} · first ${dayText(page.first.time)} · ${short(page.first.hash)}`
    }
  }
  return ''
}

const PART_NAMES: Record<ClaimPart, string> = {
  address: 'address',
  tokens: 'ERC-20 tokens',
  transactions: 'transactions',
}

const READERS: Record<ClaimPart, (api: string, address: Hex, fetch: Fetch) => Promise<Lookup<unknown>>> = {
  address: blockscoutAddress,
  tokens: blockscoutTokens,
  transactions: blockscoutTransactions,
}

export type ClaimOptions = {
  // The parts of this session. A part here is not asked again.
  known?: Partial<BlockscoutClaims>
  // Called when a part ends.
  report?: (part: ClaimPart, claim: Lookup<unknown>) => void
  // The start of each log line, such as 'deployer · '.
  prefix?: string
  // Runs one whole request, such as through a queue. The request starts
  // its timer only when it runs.
  ask?: (request: () => Promise<Lookup<unknown>>) => Promise<Lookup<unknown>>
}

// Runs the three parts. Each part logs one line and reports when it ends.
export async function readBlockscoutClaims(
  api: string,
  address: Hex,
  fetch: Fetch,
  log: Log,
  { known = {}, report = () => {}, prefix = '', ask = (request) => request() }: ClaimOptions = {},
): Promise<BlockscoutClaims> {
  const host = new URL(api).host
  const claims: Partial<Record<ClaimPart, Lookup<unknown>>> = {}
  await Promise.all(
    PARTS.map(async (name) => {
      const cached = known[name]
      const claim = cached ?? (await ask(() => READERS[name](api, address, fetch)))
      claims[name] = claim
      const text = claimText(name, claim as BlockscoutClaims[typeof name])
      log({
        source: 'explorer',
        text: `${prefix}Blockscout · ${host} · ${text}${cached ? ' · from this session' : ''}`,
        proof: false,
      })
      report(name, claim)
    }),
  )
  return claims as BlockscoutClaims
}
