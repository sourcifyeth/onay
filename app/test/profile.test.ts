// The view model of the profile: the source and the proof of each row.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { BlockscoutAddress, TokenPage } from '../src/context/blockscout.ts'
import {
  buildAccount,
  buildProfile,
  emptyHolder,
  FEW_TRANSACTIONS,
  young,
  YOUNG_DAYS,
  type Fact,
  type ProfileReads,
} from '../src/context/profile.ts'
import type { Creation } from '../src/gates/creation.ts'
import type { Hex } from '../src/messages.ts'

const CONTRACT: Hex = '0xdac17f958d2ee523a2206206994597c13d831ec7'
const DEPLOYER: Hex = '0x36928500bc1dcd7af6a2b4008875cc336b927d57'
const HASH: Hex = '0x2f1c5c2b44f771e942a8506148e256f94f1a464babc938ae0690c6e34cd79190'
const USDC: Hex = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const NOW = Date.parse('2026-10-27T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const RPC = 'eth.drpc.org'

const creation = (verified: boolean): Creation => ({
  transactionHash: HASH,
  blockNumber: 4634748,
  transactionIndex: 64,
  deployer: '0x36928500Bc1dCd7af6a2B4008875CC336b927D57',
  input: '0x60',
  verified,
})

const deployment = { transactionHash: HASH, blockNumber: 4634748, transactionIndex: 64, deployer: DEPLOYER }

const blockscoutAddress = (change: Partial<BlockscoutAddress> = {}) => ({
  ok: true as const,
  value: {
    creator: DEPLOYER,
    creationTransaction: HASH,
    name: 'TetherToken',
    scam: false,
    isContract: true,
    ...change,
  },
})

function reads(change: Partial<ProfileReads> = {}): ProfileReads {
  return {
    address: CONTRACT,
    chainId: 1,
    now: NOW,
    rpc: RPC,
    explorer: 'eth.blockscout.com',
    contract: emptyHolder(),
    sourcify: null,
    deployer: emptyHolder(),
    tokenLists: [],
    done: true,
    ...change,
  }
}

const known = <T>(fact: Fact<T>) => {
  assert.equal(
    fact.state,
    'known',
    JSON.stringify(fact, (_, value) => (typeof value === 'bigint' ? `${value}` : value)),
  )
  return fact as Extract<Fact<T>, { state: 'known' }>
}
const mark = <T>(fact: Fact<T>) => {
  const row = known(fact)
  return [row.proof, row.source]
}
const blockTime = (proof: boolean, note?: string) => ({
  ok: true as const,
  value: { value: Date.parse('2017-11-28T00:41:21Z'), proof, ...(note ? { note } : {}) },
})

test('Helios, in the window: the gate read of Sourcify, with proof on each row', () => {
  const profile = buildProfile(
    reads({
      sourcify: { deployment, creation: creation(true), read: true },
      blockTime: blockTime(true),
      deployer: { ...emptyHolder(), kind: { ok: true, value: { value: 'account', proof: true } } },
      contract: { ...emptyHolder(), balance: { ok: true, value: { value: 42n, proof: true } } },
    }),
  )
  assert.deepEqual(mark(profile.deployment), [true, 'Helios'])
  assert.deepEqual(known(profile.deployment).value, { transactionHash: HASH, block: 4634748 })
  assert.deepEqual(mark(profile.deployer.address), [true, 'Helios'])
  assert.equal(known(profile.deployer.address).value, DEPLOYER)
  assert.deepEqual(mark(profile.deployedAt), [true, 'Helios'])
  assert.deepEqual(mark(profile.deployer.kind), [true, 'Helios'])
  assert.deepEqual(mark(profile.eth), [true, 'Helios'])
})

test('Helios, out of the window: the block and its time come without proof', () => {
  const profile = buildProfile(
    reads({
      sourcify: { deployment, creation: creation(false), read: true },
      blockTime: blockTime(false, '21,000,000 blocks old'),
    }),
  )
  assert.deepEqual(mark(profile.deployment), [false, `${RPC} without proof`])
  assert.deepEqual(mark(profile.deployer.address), [false, `${RPC} without proof`])
  assert.deepEqual(mark(profile.deployedAt), [false, `${RPC} without proof`])
})

test('RPC mode: every chain read is a claim of the endpoint', () => {
  const profile = buildProfile(
    reads({
      contract: { ...emptyHolder(), blockscout: { address: blockscoutAddress() } },
      creationRead: { creation: creation(false) },
      blockTime: blockTime(false),
      deployer: {
        ...emptyHolder(),
        kind: { ok: true, value: { value: 'contract', proof: false } },
        balance: { ok: true, value: { value: 10n ** 18n, proof: false } },
      },
    }),
  )
  assert.deepEqual(mark(profile.deployment), [false, `${RPC} without proof`])
  assert.deepEqual(mark(profile.deployedAt), [false, `${RPC} without proof`])
  assert.deepEqual(mark(profile.deployer.kind), [false, `${RPC} without proof`])
  assert.deepEqual(mark(profile.deployer.eth), [false, `${RPC} without proof`])
  assert.equal(known(profile.deployer.eth).value, 10n ** 18n)
})

test('Sourcify claim only: the creation was not read, the block time of a claimed block is a claim', () => {
  const profile = buildProfile(
    reads({
      sourcify: { deployment, creation: null, read: true },
      // A block time with proof, but of a block that only Sourcify names.
      blockTime: blockTime(true),
    }),
  )
  assert.deepEqual(mark(profile.deployment), [false, 'Sourcify'])
  assert.deepEqual(mark(profile.deployer.address), [false, 'Sourcify'])
  assert.deepEqual(mark(profile.deployedAt), [false, 'Sourcify'])
})

test('Blockscout claim only: the deployer as Blockscout says, the time of its first transaction', () => {
  const profile = buildProfile(
    reads({
      contract: {
        ...emptyHolder(),
        blockscout: {
          address: blockscoutAddress(),
          firstTransaction: { ok: true, value: { hash: HASH, block: 4634748, time: 1511829681000 } },
        },
      },
      creationRead: { creation: null, reason: 'created by another contract', retry: false },
    }),
  )
  assert.deepEqual(mark(profile.deployment), [false, 'Blockscout'])
  assert.equal(known(profile.deployment).value.block, null)
  assert.deepEqual(mark(profile.deployer.address), [false, 'Blockscout'])
  assert.deepEqual(mark(profile.deployedAt), [false, 'Blockscout'])
  assert.deepEqual(mark(profile.name), [false, 'Blockscout'])
})

test('Etherscan after Blockscout: its claim when Blockscout names no creation', () => {
  const profile = buildProfile(
    reads({
      contract: {
        ...emptyHolder(),
        blockscout: { address: blockscoutAddress({ creationTransaction: null, creator: null }) },
      },
      etherscanCreation: {
        ok: true,
        value: { deployer: DEPLOYER, transactionHash: HASH, block: 4634748, time: 1511829681000 },
      },
      creationRead: { creation: null, reason: 'the chain does not know the transaction', retry: false },
      blockTime: { ok: false, reason: 'timeout' },
    }),
  )
  assert.deepEqual(mark(profile.deployment), [false, 'Etherscan'])
  assert.deepEqual(mark(profile.deployedAt), [false, 'Etherscan'])
})

test('nothing: each row is unknown with a reason', () => {
  const profile = buildProfile(
    reads({ contract: { ...emptyHolder(), blockscout: { address: { ok: false, reason: 'HTTP 502' } } } }),
  )
  for (const fact of [
    profile.deployment,
    profile.deployedAt,
    profile.deployer.address,
    profile.transactions,
    profile.eth,
  ]) {
    assert.equal(fact.state, 'unknown')
  }
  assert.deepEqual(profile.deployment, { state: 'unknown', reason: 'Blockscout: HTTP 502' })
  assert.deepEqual(profile.name, { state: 'unknown', reason: 'HTTP 502' })
  assert.equal(profile.deployer.kind.state, 'unknown')
  assert.deepEqual(profile.sources, [])
  assert.equal(profile.young, null)
})

test('while the run runs, a row that waits is pending, not unknown', () => {
  const profile = buildProfile(reads({ done: false }))
  assert.equal(profile.deployment.state, 'pending')
  assert.equal(profile.transactions.state, 'pending')
  assert.equal(profile.deployer.address.state, 'pending')
  assert.equal(profile.lists.state, 'pending')
  // A claim waits for its read from the chain.
  const waiting = buildProfile(
    reads({ done: false, contract: { ...emptyHolder(), blockscout: { address: blockscoutAddress() } } }),
  )
  assert.equal(waiting.deployment.state, 'pending')
})

test('a missing counter leaves its row unknown, the rest stays', () => {
  const profile = buildProfile(
    reads({
      contract: {
        ...emptyHolder(),
        blockscout: {
          address: blockscoutAddress(),
          counters: { ok: false, reason: 'no count of transactions' },
          firstTransaction: { ok: true, value: null },
          tokens: { ok: true, value: { tokens: [], more: false } },
        },
      },
    }),
  )
  assert.deepEqual(profile.transactions, { state: 'unknown', reason: 'no count of transactions' })
  assert.equal(known(profile.firstTransaction).value, null)
  assert.deepEqual(known(profile.tokens).value, { tokens: [], more: false, checked: true })
  assert.equal(known(profile.name).value, 'TetherToken')
})

test('the first transaction: Etherscan when Blockscout failed', () => {
  const first = { hash: HASH, block: 1, time: 5 }
  const profile = buildProfile(
    reads({
      contract: {
        ...emptyHolder(),
        blockscout: { firstTransaction: { ok: false, reason: 'HTTP 500' } },
        etherscanFirst: { ok: true, value: first },
      },
    }),
  )
  assert.deepEqual(mark(profile.firstTransaction), [false, 'Etherscan'])
  const neither = buildProfile(
    reads({
      contract: {
        ...emptyHolder(),
        blockscout: { firstTransaction: { ok: false, reason: 'HTTP 500' } },
        etherscanFirst: { ok: false, reason: 'rate limited' },
      },
    }),
  )
  assert.deepEqual(neither.firstTransaction, { state: 'unknown', reason: 'HTTP 500 · Etherscan: rate limited' })
})

const page: TokenPage = {
  tokens: [
    { token: USDC, symbol: 'USDC', decimals: 6, value: 25_000_000n },
    { token: CONTRACT, symbol: 'USDT', decimals: 6, value: 7n },
    { token: '0x0180000000000000000000000000000000004e63', symbol: 'ADAI', decimals: 18, value: 100n },
  ],
  more: true,
}

test('token amounts: from the chain when read, the claim of Blockscout when it differs or the read failed', () => {
  const profile = buildProfile(
    reads({
      contract: {
        ...emptyHolder(),
        blockscout: { tokens: { ok: true, value: page } },
        tokenAmounts: {
          [USDC]: { ok: true, value: { value: 25_000_000n, proof: true } },
          [CONTRACT]: { ok: true, value: { value: 9n, proof: true } },
          '0x0180000000000000000000000000000000004e63': { ok: false, reason: 'balanceOf gave no amount' },
        },
      },
      tokenLists: [
        {
          url: 'https://tokens.uniswap.org',
          list: {
            name: 'Uniswap Labs Default',
            version: { major: 1, minor: 0, patch: 0 },
            timestamp: '',
            tokens: [{ chainId: 1, address: USDC, symbol: 'USDC.e', decimals: 6 }],
          },
          held: null,
          fetchedAt: 1,
          error: null,
        },
      ],
    }),
  )
  const holdings = known(profile.tokens).value
  assert.equal(holdings.more, true)
  assert.equal(holdings.checked, false)
  const [usdc, usdt, adai] = holdings.tokens
  assert.deepEqual(usdc.symbol, { value: 'USDC.e', proof: false, source: 'Uniswap Labs Default' })
  assert.deepEqual(usdc.amount, { value: 25_000_000n, proof: true, source: 'Helios' })
  assert.equal(usdc.claimed, null)
  assert.deepEqual(usdt.symbol, { value: 'USDT', proof: false, source: 'Blockscout' })
  assert.deepEqual(usdt.amount, { value: 9n, proof: true, source: 'Helios' })
  assert.equal(usdt.claimed, 7n)
  assert.deepEqual(adai.amount, { value: 100n, proof: false, source: 'Blockscout' })
  assert.deepEqual(profile.sources, ['Blockscout', 'Uniswap Labs Default', 'Helios'])
})

test('the deployer: the name of an allow list first, then the one of Blockscout', () => {
  const base = {
    sourcify: { deployment, creation: creation(true), read: true },
  }
  const listed = buildProfile(
    reads({
      ...base,
      deployer: {
        ...emptyHolder(),
        blockscout: { address: blockscoutAddress({ name: 'Bitfinex' }) },
        hits: {
          ok: true,
          value: {
            hits: [{ list: 'Safe deployments', kind: 'allow', label: 'SafeProxyFactory v1.4.1', link: null }],
            missing: [],
          },
        },
      },
    }),
  )
  assert.deepEqual(known(listed.deployer.name), {
    state: 'known',
    value: 'SafeProxyFactory v1.4.1',
    proof: false,
    source: 'Safe deployments',
  })
  const named = buildProfile(
    reads({
      ...base,
      deployer: { ...emptyHolder(), blockscout: { address: blockscoutAddress({ name: 'Bitfinex' }) } },
    }),
  )
  assert.deepEqual(mark(named.deployer.name), [false, 'Blockscout'])
})

test('block-list hits and a scam mark of Blockscout; neither touches the rest', () => {
  const profile = buildProfile(
    reads({
      contract: { ...emptyHolder(), blockscout: { address: blockscoutAddress({ scam: true }) } },
      hits: {
        ok: true,
        value: {
          hits: [
            { list: 'OFAC sanctions', kind: 'block', label: 'sanctioned · ETH', link: null },
            { list: 'Safe deployments', kind: 'allow', label: 'Safe v1.4.1', link: null },
          ],
          missing: [],
        },
      },
      goPlus: { ok: true, value: { flags: [{ id: 'sanctioned', text: 'sanctioned' }], sources: ['SlowMist'] } },
    }),
  )
  assert.deepEqual(profile.blocked, [
    { value: 'sanctioned · ETH', proof: false, source: 'OFAC sanctions', of: 'address' },
    { value: 'marked as scam', proof: false, source: 'Blockscout', of: 'address' },
  ])
  assert.equal(known(profile.security.blockscout).value, 'scam')
  assert.deepEqual(mark(profile.security.goPlus as Fact<unknown>), [false, 'GoPlus'])
  assert.ok(profile.sources.includes('OFAC sanctions'))
  assert.ok(profile.sources.includes('GoPlus'))
  assert.deepEqual(buildProfile(reads({ goPlus: 'off' })).security.goPlus, { state: 'off' })
})

test('a block-list hit on the deployer is in the profile and names the deployer', () => {
  const ofac = { list: 'OFAC sanctions', kind: 'block' as const, label: 'sanctioned · ETH', link: null }
  const profile = buildProfile(
    reads({
      sourcify: { deployment, creation: creation(true), read: true },
      hits: { ok: true, value: { hits: [], missing: [] } },
      deployer: { ...emptyHolder(), hits: { ok: true, value: { hits: [ofac], missing: [] } } },
    }),
  )
  assert.deepEqual(profile.blocked, [
    { value: 'sanctioned · ETH', proof: false, source: 'OFAC sanctions', of: 'deployer' },
  ])
  assert.deepEqual(known(profile.deployer.lists).value.hits, [ofac])
  assert.ok(profile.sources.includes('OFAC sanctions'))
})

test('a list without data is missing, not a list that does not know the address', () => {
  const missing = [{ list: 'OFAC sanctions', reason: 'HTTP 503' }]
  const profile = buildProfile(reads({ hits: { ok: true, value: { hits: [], missing } } }))
  assert.deepEqual(known(profile.lists).value, { hits: [], missing })
  assert.deepEqual(profile.blocked, [])
})

test('no creation claim: a Blockscout error is the reason, with the one of Etherscan', () => {
  const failed = { ok: false as const, reason: 'HTTP 502' }
  const alone = buildProfile(reads({ contract: { ...emptyHolder(), blockscout: { address: failed } } }))
  assert.deepEqual(alone.deployment, { state: 'unknown', reason: 'Blockscout: HTTP 502' })
  const both = buildProfile(
    reads({
      contract: { ...emptyHolder(), blockscout: { address: failed } },
      etherscanCreation: { ok: false, reason: 'rate limited' },
    }),
  )
  assert.deepEqual(both.deployment, { state: 'unknown', reason: 'Blockscout: HTTP 502 · Etherscan: rate limited' })
  const none = buildProfile(
    reads({
      contract: { ...emptyHolder(), blockscout: { address: blockscoutAddress({ creationTransaction: null }) } },
    }),
  )
  assert.deepEqual(none.deployment, { state: 'unknown', reason: 'no source names the creation transaction' })
})

test('an account: the lists and GoPlus only', () => {
  const ofac = { list: 'OFAC sanctions', kind: 'block' as const, label: 'sanctioned · ETH', link: null }
  const account = buildAccount({
    address: DEPLOYER,
    chainId: 1,
    hits: { ok: true, value: { hits: [ofac], missing: [] } },
    goPlus: 'off',
    done: true,
  })
  assert.deepEqual(account, {
    address: DEPLOYER,
    chainId: 1,
    lists: { state: 'known', value: { hits: [ofac], missing: [] }, proof: false, source: 'address lists' },
    blocked: [{ value: 'sanctioned · ETH', proof: false, source: 'OFAC sanctions', of: 'address' }],
    goPlus: { state: 'off' },
    sources: ['OFAC sanctions'],
  })
  const waiting = buildAccount({ address: DEPLOYER, chainId: 1, done: false })
  assert.deepEqual([waiting.lists, waiting.goPlus], [{ state: 'pending' }, { state: 'pending' }])
})

test('young: under 30 days, or under 100 transactions', () => {
  const at = (days: number) => ({ state: 'known' as const, value: NOW - days * DAY, proof: true, source: 'Helios' })
  const count = (value: number) => ({ state: 'known' as const, value, proof: false, source: 'Blockscout' })
  assert.deepEqual(young({ deployedAt: at(3), transactions: count(5000) }, NOW), { days: 3, transactions: null })
  assert.deepEqual(young({ deployedAt: at(400), transactions: count(FEW_TRANSACTIONS - 1) }, NOW), {
    days: null,
    transactions: 99,
  })
  assert.equal(young({ deployedAt: at(YOUNG_DAYS), transactions: count(FEW_TRANSACTIONS) }, NOW), null)
  assert.equal(young({ deployedAt: { state: 'pending' }, transactions: { state: 'unknown', reason: 'x' } }, NOW), null)
  const profile = buildProfile(
    reads({
      sourcify: { deployment, creation: creation(true), read: true },
      blockTime: { ok: true, value: { value: NOW - 2 * DAY, proof: true } },
    }),
  )
  assert.deepEqual(profile.young, { days: 2, transactions: null })
})
