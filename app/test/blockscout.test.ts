// The Blockscout claims of the profile, on trimmed real answers of
// eth.blockscout.com (USDT and its deployer, 2026-10-27).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  blockscoutAddress,
  blockscoutTokens,
  blockscoutTransactions,
  FEW_TRANSACTIONS,
  MAX_TOKENS,
  pageText,
  parseAddress,
  parseTokens,
  parseTransactions,
  readBlockscoutClaims,
  tokensUrl,
  transactionsUrl,
  type ClaimPart,
} from '../src/context/blockscout.ts'
import type { Fetch, LogLine } from '../src/gates/gate.ts'
import type { Hex } from '../src/messages.ts'

const API = 'https://eth.blockscout.com'
const USDT: Hex = '0xdac17f958d2ee523a2206206994597c13d831ec7'
const DEPLOYER: Hex = '0x36928500bc1dcd7af6a2b4008875cc336b927d57'
const CREATION: Hex = '0x2f1c5c2b44f771e942a8506148e256f94f1a464babc938ae0690c6e34cd79190'

const usdtAddress = {
  block_number_balance_updated_at: 26283794,
  coin_balance: '42',
  creation_status: 'success',
  creation_transaction_hash: CREATION,
  creator_address_hash: '0x36928500Bc1dCd7af6a2B4008875CC336b927D57',
  ens_domain_name: null,
  hash: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  implementations: [],
  is_contract: true,
  is_scam: false,
  is_verified: true,
  name: 'TetherToken',
  proxy_type: null,
  public_tags: [],
  reputation: 'ok',
}

// An address that the explorer has not seen: HTTP 200 with nulls.
const unseenAddress = {
  coin_balance: null,
  creation_status: null,
  creation_transaction_hash: null,
  creator_address_hash: null,
  hash: '0x9A3F1c2B4d5e6f708192A3b4c5d6E7f809182736',
  is_contract: false,
  is_scam: false,
  name: null,
  reputation: 'ok',
}

const token = (address: string, symbol: string, decimals: string, value: string) => ({
  token: {
    address_hash: address,
    decimals,
    holders_count: '1',
    name: symbol,
    reputation: 'ok',
    symbol,
    total_supply: '1',
    type: 'ERC-20',
  },
  token_id: null,
  token_instance: null,
  value,
})

// The v12 shape: `next_page_params` null on the last page.
const deployerTokens = {
  items: [
    token('0xdAC17F958D2ee523a2206206994597C13D831ec7', 'USDT', '6', '2478410635'),
    token('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USDC', '6', '25000000'),
    // Bad fields: no address, an amount that is not a number.
    token('not an address', 'BAD', '6', '1'),
    token('0x18084fbA666a33d37592fA2633fD49a74DD93a88', 'TBTC', '18', '-5'),
    // A symbol and decimals that do not read are left out, not the token.
    token('0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39', '', 'x', '100000000'),
  ],
  next_page_params: null,
}

const firstTransactions = {
  items: [
    {
      hash: CREATION,
      block_number: 4634748,
      timestamp: '2017-11-28T00:41:21.000000Z',
      from: { hash: '0x36928500Bc1dCd7af6a2B4008875CC336b927D57' },
      to: null,
      transaction_types: ['contract_creation'],
    },
  ],
  next_page_params: {
    index: 181,
    value: '0',
    sort: 'block_number',
    order: 'asc',
    block_number: 4963010,
    items_count: 50,
  },
}

test('the address: creator, creation transaction, name, reputation', () => {
  assert.deepEqual(parseAddress(usdtAddress), {
    creator: DEPLOYER,
    creationTransaction: CREATION,
    name: 'TetherToken',
    scam: false,
    isContract: true,
  })
  assert.deepEqual(parseAddress(unseenAddress), {
    creator: null,
    creationTransaction: null,
    name: null,
    scam: false,
    isContract: false,
  })
})

test('the address: a scam mark, by the flag or by the reputation', () => {
  assert.equal(parseAddress({ ...usdtAddress, is_scam: true }).scam, true)
  assert.equal(parseAddress({ ...usdtAddress, reputation: 'scam' }).scam, true)
})

test('the address: a bad field is left out, the rest stays', () => {
  const parsed = parseAddress({ ...usdtAddress, creator_address_hash: 'no', name: 7, is_contract: 'yes' })
  assert.equal(parsed.creator, null)
  assert.equal(parsed.name, null)
  assert.equal(parsed.isContract, null)
  assert.equal(parsed.creationTransaction, CREATION)
  assert.throws(() => parseAddress('Internal server error'), /does not read/)
})

test('the tokens: good ones kept, bad ones skipped, at most ten', () => {
  const page = parseTokens(deployerTokens)
  assert.deepEqual(page.tokens, [
    { token: USDT, symbol: 'USDT', decimals: 6, value: 2478410635n },
    { token: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6, value: 25000000n },
    { token: '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39', symbol: null, decimals: null, value: 100000000n },
  ])
  assert.equal(page.more, false)
  const many = Array.from({ length: 12 }, (_, i) => token(`0x${String(i + 1).padStart(40, '0')}`, `T${i}`, '18', '1'))
  const full = parseTokens({ items: many, next_page_params: null })
  assert.equal(full.tokens.length, MAX_TOKENS)
  assert.equal(full.more, true)
  assert.equal(parseTokens({ items: [], next_page_params: { items_count: 50 } }).more, true)
  assert.throws(() => parseTokens({ message: 'Not found' }), /no list of tokens/)
})

test('the transactions: the first item, the count of the page, and the next page', () => {
  const { page, next } = parseTransactions(firstTransactions)
  assert.deepEqual(page, {
    first: { hash: CREATION, block: 4634748, time: Date.parse('2017-11-28T00:41:21Z') },
    seen: 1,
    more: true,
  })
  assert.deepEqual(next, {
    index: '181',
    value: '0',
    sort: 'block_number',
    order: 'asc',
    block_number: '4963010',
    items_count: '50',
  })
  assert.deepEqual(parseTransactions({ items: [], next_page_params: null }), {
    page: { first: null, seen: 0, more: false },
    next: null,
  })
  assert.throws(() => parseTransactions({ items: [{ hash: CREATION, timestamp: 'yesterday' }] }), /does not read/)
})

const fullPage = (count: number, last: boolean) => ({
  items: Array.from({ length: count }, () => firstTransactions.items[0]),
  next_page_params: last ? null : firstTransactions.next_page_params,
})

test('the transactions: a second page only when the first is full and under the limit', async () => {
  const calls: string[] = []
  const twoPages: Fetch = async (url) => {
    calls.push(url)
    return answer(200, url.includes('block_number=4963010') ? fullPage(30, true) : fullPage(50, false))
  }
  const page = await blockscoutTransactions(API, USDT, twoPages)
  assert.deepEqual(page.ok && [page.value.seen, page.value.more, page.value.first?.block], [80, false, 4634748])
  assert.equal(calls.length, 2)
  assert.match(calls[1], /order=asc&index=181&value=0&block_number=4963010&items_count=50$/)
  // Two full pages: at least the limit, and more.
  const busy: Fetch = async () => answer(200, fullPage(50, false))
  const floor = await blockscoutTransactions(API, USDT, busy)
  assert.deepEqual(floor.ok && [floor.value.seen, floor.value.more], [FEW_TRANSACTIONS, true])
  // A short first page: no second request.
  const few: Fetch = async (url) => {
    calls.push(url)
    return answer(200, fullPage(3, true))
  }
  calls.length = 0
  const exact = await blockscoutTransactions(API, USDT, few)
  assert.deepEqual(exact.ok && [exact.value.seen, exact.value.more], [3, false])
  assert.equal(calls.length, 1)
})

test('the URLs: the API of the instance, tokens of ERC-20 only, oldest first', () => {
  assert.equal(tokensUrl(`${API}/`, USDT), `${API}/api/v2/addresses/${USDT}/tokens?type=ERC-20`)
  assert.equal(transactionsUrl(API, USDT), `${API}/api/v2/addresses/${USDT}/transactions?sort=block_number&order=asc`)
  assert.equal(
    transactionsUrl(API, USDT, { block_number: '4963010', index: '181' }),
    `${API}/api/v2/addresses/${USDT}/transactions?sort=block_number&order=asc&block_number=4963010&index=181`,
  )
})

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

test('each lookup: 404 of Blockscout is an unknown address, other errors give a reason', async () => {
  const notFound: Fetch = async () => answer(404, { message: 'Not found' })
  assert.deepEqual(await blockscoutAddress(API, USDT, notFound), {
    ok: true,
    value: { creator: null, creationTransaction: null, name: null, scam: false, isContract: null },
    notFound: true,
  })
  assert.deepEqual(await blockscoutTokens(API, USDT, notFound), {
    ok: true,
    value: { tokens: [], more: false },
    notFound: true,
  })
  assert.deepEqual(await blockscoutTransactions(API, USDT, notFound), {
    ok: true,
    value: { first: null, seen: 0, more: false },
    notFound: true,
  })
  const proxy404: Fetch = async () => answer(404, { error: 'no route' })
  assert.deepEqual(await blockscoutTokens(API, USDT, proxy404), { ok: false, reason: 'HTTP 404' })
  const limited: Fetch = async () => answer(429, {})
  assert.deepEqual(await blockscoutTokens(API, USDT, limited), { ok: false, reason: 'rate limited', limited: true })
  const refused: Fetch = async () => answer(403, {})
  assert.deepEqual(await blockscoutTokens(API, USDT, refused), {
    ok: false,
    reason: 'the instance refused the request',
  })
  const broken: Fetch = async () => new Response('<html>', { status: 200 })
  assert.deepEqual(await blockscoutTokens(API, USDT, broken), { ok: false, reason: 'an answer that is not JSON' })
  const down: Fetch = async () => {
    throw new TypeError('Failed to fetch')
  }
  assert.deepEqual(await blockscoutTokens(API, USDT, down), {
    ok: false,
    reason: 'network error · Failed to fetch',
  })
})

test('readBlockscoutClaims: each part fails on its own, a known part is not asked again', async () => {
  const calls: string[] = []
  const fetch: Fetch = async (url) => {
    calls.push(url)
    if (url.includes('/tokens')) return answer(500, {})
    if (url.includes('block_number=4963010')) return answer(200, fullPage(0, true))
    if (url.includes('/transactions')) return answer(200, firstTransactions)
    return answer(200, usdtAddress)
  }
  const lines: LogLine[] = []
  const reported: ClaimPart[] = []
  const known = { address: { ok: true as const, value: parseAddress(usdtAddress) } }
  let asked = 0
  const claims = await readBlockscoutClaims(API, USDT, fetch, (line) => lines.push(line), {
    known,
    report: (part) => reported.push(part),
    ask: (request) => {
      asked += 1
      return request()
    },
  })
  // The tokens, and two pages of transactions.
  assert.equal(calls.length, 3)
  // Each part that goes out runs through `ask`, with its pages inside.
  assert.equal(asked, 2)
  assert.ok(calls.every((url) => !url.endsWith(USDT)))
  assert.deepEqual(claims.tokens, { ok: false, reason: 'HTTP 500' })
  assert.deepEqual(claims.transactions.ok && claims.transactions.value, {
    first: { hash: CREATION, block: 4634748, time: Date.parse('2017-11-28T00:41:21Z') },
    seen: 1,
    more: false,
  })
  assert.deepEqual(reported.sort(), ['address', 'tokens', 'transactions'])
  assert.ok(lines.every((line) => line.source === 'explorer' && line.proof === false))
  const texts = lines.map((line) => line.text)
  assert.ok(texts.includes('Blockscout · eth.blockscout.com · ERC-20 tokens · not read · HTTP 500'))
  assert.ok(
    texts.includes(
      'Blockscout · eth.blockscout.com · address · name TetherToken · creator 0x3692…7d57 · creation transaction 0x2f1c…9190 · from this session',
    ),
  )
  assert.ok(texts.includes('Blockscout · eth.blockscout.com · transactions · 1 · first 2017-11-28 · 0x2f1c…9190'))
  assert.equal(pageText({ first: null, seen: 100, more: true }), '100+')
  assert.equal(pageText({ first: null, seen: 42, more: false }), '42')
})
