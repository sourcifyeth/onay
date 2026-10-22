import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  acceptTokenListUpdate,
  applies,
  compareVersions,
  fetchTokenList,
  isHttpsUrl,
  isStale,
  listedOn,
  MAX_BYTES,
  newEntry,
  parseEntries,
  parseTokenList,
  REFRESH_AFTER,
  summary,
  tokenListStore,
  versionText,
  withAccepted,
  withError,
  withFetched,
  type TokenList,
} from '../src/clear-signing/tokenLists.ts'
import type { Hex } from '../src/messages.ts'

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const usdc = USDC.toLowerCase() as Hex
const WETH: Hex = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

const v = (major: number, minor = 0, patch = 0) => ({ major, minor, patch })

// Excerpts of real lists: checksummed and lowercase addresses, a Solana
// entry, a duplicate pair, and extensions.
const uniswap = {
  name: 'Uniswap Labs Default',
  timestamp: '2026-10-21T00:00:00.000Z',
  version: v(22, 31, 0),
  tags: {},
  logoURI: 'ipfs://QmNa8mQkrNKp1WEEeGjFezDmDeodkWRevGFN8JCV7b4Xir',
  keywords: ['uniswap', 'default'],
  tokens: [
    {
      chainId: 1,
      address: USDC,
      name: 'USDCoin',
      symbol: 'USDC',
      decimals: 6,
      logoURI: 'https://example/usdc.png',
      extensions: { bridgeInfo: { '10': { tokenAddress: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607' } } },
    },
    { chainId: 1, address: WETH, name: 'Wrapped Ether', symbol: 'WETH', decimals: 18 },
    { chainId: 1, address: WETH.toUpperCase().replace('0X', '0x'), name: 'dup', symbol: 'WETH', decimals: 18 },
    { chainId: 10, address: USDC, name: 'USDCoin', symbol: 'USDC', decimals: 6 },
    {
      chainId: 501000101,
      address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      name: 'USDC',
      symbol: 'USDC',
      decimals: 6,
    },
  ],
}

function list(change: Partial<TokenList> = {}): TokenList {
  return { name: 'CoW Swap', version: v(7, 12, 0), timestamp: '', tokens: [], ...change }
}

test('isHttpsUrl accepts https only', () => {
  assert.equal(isHttpsUrl('https://tokens.uniswap.org'), true)
  assert.equal(isHttpsUrl('https://files.cow.fi/tokens/CowSwap.json'), true)
  for (const value of ['http://tokens.uniswap.org', 'ipfs://Qm', 'tokens.uniswap.eth', 'https://a b', '']) {
    assert.equal(isHttpsUrl(value), false, value)
  }
})

test('parseTokenList keeps the EVM tokens in lowercase, once each, and drops the rest', () => {
  const { list: parsed, skipped } = parseTokenList(uniswap)
  assert.equal(parsed.name, 'Uniswap Labs Default')
  assert.deepEqual(parsed.version, v(22, 31, 0))
  assert.equal(parsed.timestamp, '2026-10-21T00:00:00.000Z')
  assert.deepEqual(parsed.tokens, [
    { chainId: 1, address: usdc, symbol: 'USDC', decimals: 6 },
    { chainId: 1, address: WETH, symbol: 'WETH', decimals: 18 },
    { chainId: 10, address: usdc, symbol: 'USDC', decimals: 6 },
  ])
  assert.equal(skipped, 1)
})

test('parseTokenList rejects the wrong shape', () => {
  assert.throws(() => parseTokenList(null), /not a JSON object/)
  assert.throws(() => parseTokenList([]), /not a JSON object/)
  assert.throws(() => parseTokenList({ version: v(1), tokens: [] }), /no name/)
  assert.throws(() => parseTokenList({ name: 'x', version: { major: 1 }, tokens: [] }), /no version/)
  assert.throws(() => parseTokenList({ name: 'x', version: v(1), tokens: {} }), /no tokens array/)
  assert.throws(() => parseTokenList({ name: 'x', version: v(1), tokens: [7] }), /not an object/)
  const many = { name: 'x', version: v(1), tokens: Array.from({ length: 10_001 }, () => ({})) }
  assert.throws(() => parseTokenList(many), /more than 10000/)
})

test('parseTokenList skips a bad chain id or bad decimals', () => {
  const tokens = [
    { chainId: 0, address: USDC, symbol: 'A', decimals: 6 },
    { chainId: '1', address: USDC, symbol: 'B', decimals: 6 },
    { chainId: 1, address: USDC, symbol: 'C', decimals: 256 },
    { chainId: 1, address: USDC, symbol: 'D', decimals: 1.5 },
    { chainId: 1, address: USDC, decimals: 6 },
  ]
  const { list: parsed, skipped } = parseTokenList({ name: 'x', version: v(1), tokens })
  assert.deepEqual(parsed.tokens, [{ chainId: 1, address: usdc, symbol: '', decimals: 6 }])
  assert.equal(skipped, 4)
})

test('fetchTokenList reads JSON, and refuses an error, a non-JSON body, or an oversized one', async () => {
  const ok = async () => Response.json(uniswap)
  const { list: parsed } = await fetchTokenList('https://x', ok)
  assert.equal(parsed.tokens.length, 3)
  await assert.rejects(
    fetchTokenList('https://x', async () => new Response('', { status: 503 })),
    /HTTP 503/,
  )
  await assert.rejects(
    fetchTokenList('https://x', async () => new Response('<html>')),
    /not JSON/,
  )
  const big = async () => new Response('{}', { headers: { 'content-length': String(MAX_BYTES + 1) } })
  await assert.rejects(fetchTokenList('https://x', big), /over 8 MB/)
  const long = async () => new Response(' '.repeat(MAX_BYTES + 1))
  await assert.rejects(fetchTokenList('https://x', long), /over 8 MB/)
})

test('fetchTokenList gives up after the timeout', async () => {
  // The fake waits past the timeout and then reads the signal.
  const slow = async (_url: string, init?: { signal?: AbortSignal }) => {
    await new Promise((resolve) => setTimeout(resolve, 30))
    init?.signal?.throwIfAborted()
    return Response.json(uniswap)
  }
  await assert.rejects(fetchTokenList('https://x', slow, 10), { name: 'TimeoutError' })
  const { list: parsed } = await fetchTokenList('https://x', slow, 1000)
  assert.equal(parsed.tokens.length, 3)
})

test('versions compare by major, minor, patch', () => {
  assert.equal(compareVersions(v(1, 2, 3), v(1, 2, 3)), 0)
  assert.ok(compareVersions(v(2), v(1, 9, 9)) > 0)
  assert.ok(compareVersions(v(1, 2), v(1, 3)) < 0)
  assert.ok(compareVersions(v(1, 2, 4), v(1, 2, 3)) > 0)
  assert.equal(versionText(v(7, 12, 0)), 'v7.12.0')
})

test('a minor or patch bump applies at once; a major bump or a lower version waits', () => {
  const current = list({ version: v(7, 12, 0) })
  assert.equal(applies(null, current), true)
  assert.equal(applies(current, list({ version: v(7, 12, 0) })), true)
  assert.equal(applies(current, list({ version: v(7, 13, 0) })), true)
  assert.equal(applies(current, list({ version: v(7, 12, 1) })), true)
  assert.equal(applies(current, list({ version: v(8, 0, 0) })), false)
  assert.equal(applies(current, list({ version: v(7, 11, 0) })), false)
  assert.equal(applies(current, list({ version: v(6, 0, 0) })), false)
})

test('withFetched keeps the accepted copy and holds a major update until accepted', () => {
  const first = withFetched(newEntry('https://x'), list({ version: v(7, 12, 0) }), 100)
  assert.equal(first.list?.version.minor, 12)
  assert.equal(first.held, null)
  assert.equal(first.fetchedAt, 100)
  const held = withFetched(first, list({ version: v(8, 0, 0) }), 200)
  assert.equal(held.list?.version.major, 7)
  assert.equal(held.held?.version.major, 8)
  assert.equal(held.fetchedAt, 200)
  const accepted = withAccepted(held)
  assert.equal(accepted.list?.version.major, 8)
  assert.equal(accepted.held, null)
  assert.equal(withAccepted(first), first)
  // The same version again drops a held copy.
  const same = withFetched(held, list({ version: v(7, 12, 0) }), 300)
  assert.equal(same.held, null)
})

test('withError keeps the last good copy and notes the time', () => {
  const good = withFetched(newEntry('https://x'), list(), 100)
  const failed = withError(good, 'HTTP 503', 200)
  assert.equal(failed.list, good.list)
  assert.equal(failed.error, 'HTTP 503')
  assert.equal(failed.fetchedAt, 200)
  const again = withFetched(failed, list(), 300)
  assert.equal(again.error, null)
})

test('isStale after a day, or when never fetched', () => {
  assert.equal(isStale(newEntry('https://x'), 0), true)
  const entry = withFetched(newEntry('https://x'), list(), 1000)
  assert.equal(isStale(entry, 1000 + REFRESH_AFTER - 1), false)
  assert.equal(isStale(entry, 1000 + REFRESH_AFTER), true)
})

test('listedOn joins the accepted lists of one chain and names each list once', () => {
  const a = withFetched(
    newEntry('https://a'),
    list({ name: 'A', tokens: [{ chainId: 1, address: usdc, symbol: 'USDC', decimals: 6 }] }),
    0,
  )
  const b = withFetched(
    newEntry('https://b'),
    list({
      name: 'B',
      tokens: [
        { chainId: 1, address: usdc, symbol: 'USDC', decimals: 6 },
        { chainId: 1, address: WETH, symbol: 'WETH', decimals: 18 },
        { chainId: 10, address: WETH, symbol: 'WETH', decimals: 18 },
      ],
    }),
    0,
  )
  const held = {
    ...newEntry('https://c'),
    held: list({ name: 'C', tokens: [{ chainId: 1, address: WETH, symbol: 'W', decimals: 18 }] }),
  }
  const listed = listedOn([a, b, held, newEntry('https://d')], 1)
  assert.deepEqual(
    [...listed],
    [
      [usdc, ['A', 'B']],
      [WETH, ['B']],
    ],
  )
  assert.deepEqual(summary(b.list!), { tokens: 3, chains: 2 })
})

test('parseEntries reads the saved entries, drops the broken ones, and gives null when nothing was saved', () => {
  const saved = [
    { url: 'https://a', list: uniswap, held: null, fetchedAt: 5, error: null },
    { url: 'https://a', list: null, held: null, fetchedAt: null, error: null },
    { url: 'http://b', list: null, held: null, fetchedAt: null, error: null },
    { url: 'https://c', list: { name: 'broken' }, held: uniswap, fetchedAt: 'x', error: 'HTTP 503' },
    'junk',
  ]
  const entries = parseEntries(saved)!
  assert.equal(entries.length, 2)
  assert.equal(entries[0].url, 'https://a')
  assert.equal(entries[0].list?.tokens.length, 3)
  assert.equal(entries[0].fetchedAt, 5)
  assert.equal(entries[1].list, null)
  assert.equal(entries[1].held?.name, 'Uniswap Labs Default')
  assert.equal(entries[1].fetchedAt, null)
  assert.equal(entries[1].error, 'HTTP 503')
  assert.equal(parseEntries(null), null)
  assert.equal(parseEntries({}), null)
})

test('without saved entries the store starts with the default list', () => {
  const entries = tokenListStore.getSnapshot()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].url, 'https://tokens.uniswap.org')
  assert.equal(entries[0].list, null)
  acceptTokenListUpdate(entries[0].url)
  assert.equal(tokenListStore.getSnapshot()[0].held, null)
})
