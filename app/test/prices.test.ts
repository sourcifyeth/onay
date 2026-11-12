import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Hex } from '../src/messages.ts'
import { dollars, fetchPrices, hasPrices, NATIVE, parsePrices, priceCache, pricesUrl } from '../src/context/prices.ts'

const USDC: Hex = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const WETH: Hex = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Hex
const NOW = 1_800_000_000_000
const fresh = NOW / 1000 - 60

test('the URL: the DefiLlama name of the chain and each token once, in lower case', () => {
  assert.equal(
    pricesUrl(1, [NATIVE, USDC, WETH, USDC]),
    `https://coins.llama.fi/prices/current/ethereum:${NATIVE},ethereum:${USDC},ethereum:${WETH.toLowerCase()}`,
  )
  assert.equal(pricesUrl(8453, [USDC]), `https://coins.llama.fi/prices/current/base:${USDC}`)
  // A test network has no prices, and no token needs none.
  assert.equal(pricesUrl(11155111, [USDC]), null)
  assert.equal(pricesUrl(1, []), null)
  assert.equal(hasPrices(1), true)
  assert.equal(hasPrices(11155111), false)
})

test('the answer: recent and trusted prices only, by address in lower case', () => {
  const body = {
    coins: {
      [`ethereum:${USDC}`]: { price: 0.9997, timestamp: fresh, confidence: 0.999 },
      [`ethereum:${WETH}`]: { price: 1989.29, timestamp: fresh, confidence: 0.99 },
      // Two hours old.
      [`ethereum:${NATIVE}`]: { price: 1991.18, timestamp: fresh - 7200, confidence: 0.999 },
      // DefiLlama trusts it little.
      [`ethereum:0x${'11'.repeat(20)}`]: { price: 3, timestamp: fresh, confidence: 0.5 },
      // Another chain, and values that are not prices.
      [`base:${USDC}`]: { price: 1, timestamp: fresh },
      [`ethereum:0x${'22'.repeat(20)}`]: { price: 'one', timestamp: fresh },
      [`ethereum:0x${'33'.repeat(20)}`]: { price: -1, timestamp: fresh },
    },
  }
  assert.deepEqual(
    parsePrices(body, 1, NOW),
    new Map([
      [USDC, 0.9997],
      [WETH.toLowerCase(), 1989.29],
    ]),
  )
  assert.deepEqual(parsePrices({ coins: 'none' }, 1, NOW), new Map())
  assert.deepEqual(parsePrices(null, 1, NOW), new Map())
})

test('fetchPrices: one request, and an error that says who failed', async () => {
  const asked: string[] = []
  const ok = async (url: string) => {
    asked.push(url)
    return new Response(JSON.stringify({ coins: { [`ethereum:${USDC}`]: { price: 1, timestamp: fresh } } }))
  }
  assert.deepEqual(await fetchPrices(1, [USDC], ok, NOW), new Map([[USDC, 1]]))
  assert.equal(asked.length, 1)
  await assert.rejects(
    fetchPrices(1, [USDC], async () => new Response('', { status: 503 }), NOW),
    /DefiLlama answered HTTP 503/,
  )
  await assert.rejects(
    fetchPrices(1, [USDC], async () => new Response('<html>'), NOW),
    /DefiLlama gave no JSON/,
  )
  // No request for a chain without prices.
  assert.deepEqual(await fetchPrices(11155111, [USDC], ok, NOW), new Map())
  assert.equal(asked.length, 1)
})

test('the cache: the same tokens ask once, a failure asks again', async () => {
  let calls = 0
  let fail = true
  const fetch = async () => {
    calls++
    if (fail) return new Response('', { status: 500 })
    return new Response(JSON.stringify({ coins: { [`ethereum:${USDC}`]: { price: 1, timestamp: fresh } } }))
  }
  let now = NOW
  const prices = priceCache(fetch, () => now)
  await assert.rejects(prices(1, [USDC]))
  fail = false
  assert.deepEqual(await prices(1, [USDC]), new Map([[USDC, 1]]))
  assert.deepEqual(await prices(1, [USDC]), new Map([[USDC, 1]]))
  assert.equal(calls, 2)
  now += 6 * 60 * 1000
  await prices(1, [USDC])
  assert.equal(calls, 3)
})

test('dollars: the amount in whole tokens times the price', () => {
  assert.equal(dollars(1_500_000n, 6, 2), 3)
  assert.equal(dollars(-(10n ** 18n), 18, 1991.18), -1991.18)
  assert.equal(dollars(0n, 18, 5), 0)
  // Above the safe integers of JavaScript, the value stays close.
  assert.ok(Math.abs(dollars(10n ** 30n, 18, 1) - 1e12) < 1)
})
