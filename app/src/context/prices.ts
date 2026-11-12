// Dollar values for the effects of a transaction: the price of each
// token from DefiLlama, a free service with no key. A price is a claim of
// a third party, and nothing in the checks depends on it. The request
// tells DefiLlama which tokens the transaction moves, so a switch in the
// settings turns it off. The network call is a parameter, so the tests
// give a fake.

import type { Hex } from '../messages.ts'
import { errorText, readCapped, type Fetch } from '../gates/gate.ts'

export const PRICE_SOURCE = 'DefiLlama'
const PRICES_URL = 'https://coins.llama.fi/prices/current/'

// The names that DefiLlama gives the chains. A chain that is not here,
// such as a test network, gets no prices.
const CHAINS: Record<number, string> = {
  1: 'ethereum',
  10: 'optimism',
  56: 'bsc',
  100: 'xdai',
  130: 'unichain',
  137: 'polygon',
  146: 'sonic',
  324: 'era',
  480: 'wc',
  8453: 'base',
  42161: 'arbitrum',
  42220: 'celo',
  43114: 'avax',
  59144: 'linea',
  534352: 'scroll',
  7777777: 'zora',
}

// DefiLlama names the native coin of a chain with the zero address.
export const NATIVE: Hex = '0x0000000000000000000000000000000000000000'

// A price older than this, or one that DefiLlama trusts less, is left
// out.
const MAX_AGE = 60 * 60 * 1000
const MIN_CONFIDENCE = 0.9
const TIMEOUT = 5_000
const MAX_BYTES = 256 * 1024
// The prices of one chain stay this long in the session.
const KEEP = 5 * 60 * 1000

// Dollars for one whole token, by address in lower case.
export type Prices = Map<Hex, number>

export type PriceState =
  | { status: 'off' }
  // The chain has no prices, such as a test network.
  | { status: 'unsupported' }
  | { status: 'loading' }
  | { status: 'passed'; prices: Prices }
  | { status: 'failed'; reason: string }

export function hasPrices(chainId: number): boolean {
  return CHAINS[chainId] !== undefined
}

export function pricesUrl(chainId: number, tokens: Hex[]): string | null {
  const chain = CHAINS[chainId]
  if (!chain || tokens.length === 0) return null
  const keys = [...new Set(tokens.map((token) => token.toLowerCase()))].map((token) => `${chain}:${token}`)
  return `${PRICES_URL}${keys.join(',')}`
}

// The answer of DefiLlama: each price that is a finite number, recent,
// and trusted enough. A token that DefiLlama does not know is not in it.
export function parsePrices(body: unknown, chainId: number, now: number): Prices {
  const prices: Prices = new Map()
  const chain = CHAINS[chainId]
  const coins = (body as { coins?: unknown } | null)?.coins
  if (!chain || typeof coins !== 'object' || coins === null) return prices
  for (const [key, value] of Object.entries(coins as Record<string, unknown>)) {
    const match = new RegExp(`^${chain}:(0x[0-9a-fA-F]{40})$`).exec(key)
    if (!match || typeof value !== 'object' || value === null) continue
    const { price, timestamp, confidence } = value as Record<string, unknown>
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) continue
    if (typeof timestamp !== 'number' || now - timestamp * 1000 > MAX_AGE) continue
    if (typeof confidence === 'number' && confidence < MIN_CONFIDENCE) continue
    prices.set(match[1].toLowerCase() as Hex, price)
  }
  return prices
}

export async function fetchPrices(chainId: number, tokens: Hex[], fetch: Fetch, now: number): Promise<Prices> {
  const url = pricesUrl(chainId, tokens)
  if (!url) return new Map()
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) })
  if (!response.ok) throw new Error(`${PRICE_SOURCE} answered HTTP ${response.status}`)
  let body: unknown
  try {
    body = JSON.parse(await readCapped(response, MAX_BYTES, 'the answer'))
  } catch (error) {
    throw new Error(`${PRICE_SOURCE} gave no JSON · ${errorText(error)}`)
  }
  return parsePrices(body, chainId, now)
}

// The prices of the session, kept for a few minutes, so a second review
// of the same tokens asks nothing.
export function priceCache(fetch: Fetch, now: () => number) {
  const kept = new Map<string, { at: number; prices: Promise<Prices> }>()
  return (chainId: number, tokens: Hex[]): Promise<Prices> => {
    const key = pricesUrl(chainId, [...tokens].sort()) ?? ''
    const entry = kept.get(key)
    if (entry && now() - entry.at < KEEP) return entry.prices
    const prices = fetchPrices(chainId, tokens, fetch, now())
    kept.set(key, { at: now(), prices })
    // A failed request is not kept: the next review asks again.
    prices.catch(() => kept.delete(key))
    return prices
  }
}

// The dollar value of an amount of a token with these decimals.
export function dollars(amount: bigint, decimals: number, price: number): number {
  const negative = amount < 0n
  const size = negative ? -amount : amount
  const scale = 10n ** BigInt(decimals)
  // Six decimals of the token are enough for a dollar value.
  const whole = Number(size / scale) + Number(((size % scale) * 1_000_000n) / scale) / 1_000_000
  return (negative ? -whole : whole) * price
}
