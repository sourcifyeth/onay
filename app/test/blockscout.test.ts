// The Blockscout claims of the profile, on trimmed real answers of
// eth.blockscout.com (USDT and its deployer, 2026-10-27).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  blockscoutAddress,
  blockscoutCounters,
  blockscoutFirstTransaction,
  blockscoutTokens,
  firstTransactionUrl,
  MAX_TOKENS,
  parseAddress,
  parseCounters,
  parseFirstTransaction,
  parseTokens,
  readBlockscoutClaims,
  tokensUrl,
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

const counters = {
  transactions_count: '1356514',
  token_transfers_count: '59',
  gas_usage_count: '54863744147',
  validations_count: '0',
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
    filter: 'to',
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

test('the counters: the count of transactions, or an error', () => {
  assert.equal(parseCounters(counters), 1356514)
  assert.equal(parseCounters({ transactions_count: 12 }), 12)
  assert.throws(() => parseCounters({ ...counters, transactions_count: 'many' }), /no count/)
  assert.throws(() => parseCounters({ transactions_count: '99999999999999999999' }), /no count/)
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

test('the first transaction: the first item, or null for none', () => {
  assert.deepEqual(parseFirstTransaction(firstTransactions), {
    hash: CREATION,
    block: 4634748,
    time: Date.parse('2017-11-28T00:41:21Z'),
  })
  assert.equal(parseFirstTransaction({ items: [], next_page_params: null }), null)
  assert.throws(() => parseFirstTransaction({ items: [{ hash: CREATION, timestamp: 'yesterday' }] }), /does not read/)
})

test('the URLs: the API of the instance, tokens of ERC-20 only, oldest first', () => {
  assert.equal(tokensUrl(`${API}/`, USDT), `${API}/api/v2/addresses/${USDT}/tokens?type=ERC-20`)
  assert.equal(
    firstTransactionUrl(API, USDT),
    `${API}/api/v2/addresses/${USDT}/transactions?filter=to&sort=block_number&order=asc`,
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
  assert.deepEqual(await blockscoutFirstTransaction(API, USDT, notFound), { ok: true, value: null, notFound: true })
  // No count is not a count of 0.
  assert.deepEqual(await blockscoutCounters(API, USDT, notFound), {
    ok: false,
    reason: 'Blockscout does not know the address',
  })
  const proxy404: Fetch = async () => answer(404, { error: 'no route' })
  assert.deepEqual(await blockscoutCounters(API, USDT, proxy404), { ok: false, reason: 'HTTP 404' })
  const limited: Fetch = async () => answer(429, {})
  assert.deepEqual(await blockscoutCounters(API, USDT, limited), { ok: false, reason: 'rate limited', limited: true })
  const refused: Fetch = async () => answer(403, {})
  assert.deepEqual(await blockscoutCounters(API, USDT, refused), {
    ok: false,
    reason: 'the instance refused the request',
  })
  const broken: Fetch = async () => new Response('<html>', { status: 200 })
  assert.deepEqual(await blockscoutCounters(API, USDT, broken), { ok: false, reason: 'an answer that is not JSON' })
  const down: Fetch = async () => {
    throw new TypeError('Failed to fetch')
  }
  assert.deepEqual(await blockscoutCounters(API, USDT, down), {
    ok: false,
    reason: 'network error · Failed to fetch',
  })
})

test('readBlockscoutClaims: each part fails on its own, a known part is not asked again', async () => {
  const calls: string[] = []
  const fetch: Fetch = async (url) => {
    calls.push(url)
    if (url.endsWith('/counters')) return answer(500, {})
    if (url.includes('/tokens')) return answer(200, deployerTokens)
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
  assert.equal(calls.length, 3)
  // Each request that goes out runs through `ask`.
  assert.equal(asked, 3)
  assert.ok(calls.every((url) => !url.endsWith(USDT)))
  assert.deepEqual(claims.counters, { ok: false, reason: 'HTTP 500' })
  assert.equal(claims.tokens.ok && claims.tokens.value.tokens.length, 3)
  assert.equal(claims.firstTransaction.ok && claims.firstTransaction.value?.block, 4634748)
  assert.deepEqual(reported.sort(), ['address', 'counters', 'firstTransaction', 'tokens'])
  assert.ok(lines.every((line) => line.source === 'explorer' && line.proof === false))
  const texts = lines.map((line) => line.text)
  assert.ok(texts.includes('Blockscout · eth.blockscout.com · transactions · not read · HTTP 500'))
  assert.ok(
    texts.includes(
      'Blockscout · eth.blockscout.com · address · name TetherToken · creator 0x3692…7d57 · creation transaction 0x2f1c…9190 · from this session',
    ),
  )
  assert.ok(texts.includes('Blockscout · eth.blockscout.com · first transaction · 2017-11-28 · 0x2f1c…9190'))
})
