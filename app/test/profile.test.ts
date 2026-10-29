// The view model of the profile: the source and the proof of each row.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { BlockscoutAddress, TokenPage } from '../src/context/blockscout.ts'
import {
  buildAccount,
  buildProfile,
  CHAIN,
  emptyHolder,
  LISTS,
  type Fact,
  type ProfileReads,
  young,
  YOUNG_DAYS,
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
      deployer: {
        ...emptyHolder(),
        kind: { ok: true, value: { value: 'account', proof: true } },
        account: { ok: true, value: { value: { balance: 1n, nonce: 7n }, proof: true } },
      },
      contract: { ...emptyHolder(), account: { ok: true, value: { value: { balance: 42n, nonce: 1n }, proof: true } } },
    }),
  )
  assert.deepEqual(mark(profile.deployment), [true, 'Helios'])
  assert.deepEqual(known(profile.deployment).value, { transactionHash: HASH, block: 4634748 })
  assert.deepEqual(mark(profile.deployer.address), [true, 'Helios'])
  assert.equal(known(profile.deployer.address).value, DEPLOYER)
  assert.deepEqual(mark(profile.deployedAt), [true, 'Helios'])
  assert.deepEqual(mark(profile.deployer.kind), [true, 'Helios'])
  assert.deepEqual(mark(profile.eth), [true, 'Helios'])
  assert.equal(known(profile.eth).value, 42n)
  // The nonce of an account, with its proof. A contract has none.
  assert.deepEqual(mark(profile.deployer.nonce as Fact<bigint>), [true, 'Helios'])
  assert.equal(known(profile.deployer.nonce as Fact<bigint>).value, 7n)
  assert.deepEqual(profile.nonce, { state: 'contract' })
})

test('the nonce of the deployer: none for a contract, and only once its code is known', () => {
  const account = { ok: true as const, value: { value: { balance: 0n, nonce: 3n }, proof: false } }
  const deployerWith = (kind: ProfileReads['deployer']['kind'], done = true) =>
    buildProfile(
      reads({
        done,
        sourcify: { deployment, creation: creation(true), read: true },
        deployer: { ...emptyHolder(), account, ...(kind ? { kind } : {}) },
      }),
    ).deployer.nonce
  assert.deepEqual(deployerWith({ ok: true, value: { value: 'contract', proof: true } }), { state: 'contract' })
  assert.deepEqual(deployerWith({ ok: true, value: { value: 'delegated', proof: false } }), {
    state: 'known',
    value: 3n,
    proof: false,
    source: `${RPC} without proof`,
  })
  assert.deepEqual(deployerWith({ ok: false, reason: 'timeout' }), {
    state: 'unknown',
    reason: 'the code of the address is not known',
  })
  assert.deepEqual(deployerWith(undefined, false), { state: 'pending', source: CHAIN })
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
        account: { ok: true, value: { value: { balance: 10n ** 18n, nonce: 1n }, proof: false } },
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
          transactions: { ok: true, value: { hash: HASH, block: 4634748, time: 1511829681000 } },
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
    profile.firstTransaction,
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
  // Each row names the source it waits for.
  assert.deepEqual(profile.deployment, { state: 'pending', source: 'Blockscout' })
  assert.deepEqual(profile.firstTransaction, { state: 'pending', source: 'Blockscout' })
  assert.deepEqual(profile.deployer.address, { state: 'pending', source: 'Blockscout' })
  assert.deepEqual(profile.deployer.kind, { state: 'pending', source: 'Blockscout' })
  assert.deepEqual(profile.eth, { state: 'pending', source: CHAIN })
  assert.deepEqual(profile.lists, { state: 'pending', source: LISTS })
  // A claim waits for its read from the chain.
  const waiting = buildProfile(
    reads({ done: false, contract: { ...emptyHolder(), blockscout: { address: blockscoutAddress() } } }),
  )
  assert.deepEqual(waiting.deployment, { state: 'pending', source: CHAIN })
  assert.deepEqual(waiting.deployedAt, { state: 'pending', source: CHAIN })
})

test('a failed page of transactions leaves its rows unknown, the rest stays', () => {
  const profile = buildProfile(
    reads({
      contract: {
        ...emptyHolder(),
        blockscout: {
          address: blockscoutAddress(),
          transactions: { ok: false, reason: 'HTTP 500' },
          tokens: { ok: true, value: { tokens: [], more: false } },
        },
      },
    }),
  )
  assert.deepEqual(profile.firstTransaction, { state: 'unknown', reason: 'HTTP 500' })
  assert.deepEqual(known(profile.tokens).value, { tokens: [], more: false, checked: true })
  assert.equal(known(profile.name).value, 'TetherToken')
})

test('the first transaction: Etherscan when Blockscout failed', () => {
  const first = { hash: HASH, block: 1, time: 5 }
  const profile = buildProfile(
    reads({
      contract: {
        ...emptyHolder(),
        blockscout: { transactions: { ok: false, reason: 'HTTP 500' } },
        etherscanTransactions: { ok: true, value: first },
      },
    }),
  )
  assert.deepEqual(mark(profile.firstTransaction), [false, 'Etherscan'])
  assert.deepEqual(known(profile.firstTransaction).value, first)
  const neither = buildProfile(
    reads({
      contract: {
        ...emptyHolder(),
        blockscout: { transactions: { ok: false, reason: 'HTTP 500' } },
        etherscanTransactions: { ok: false, reason: 'rate limited' },
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
        tokenDecimals: {
          [CONTRACT]: { ok: true, value: { value: 6, proof: true } },
          '0x0180000000000000000000000000000000004e63': { ok: false, reason: 'decimals gave no number' },
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
  // Not read from the chain: the decimals of the token list.
  assert.deepEqual(usdc.decimals, { value: 6, proof: false, source: 'Uniswap Labs Default' })
  assert.equal(usdc.claimed, null)
  assert.deepEqual(usdt.symbol, { value: 'USDT', proof: false, source: 'Blockscout' })
  assert.deepEqual(usdt.amount, { value: 9n, proof: true, source: 'Helios' })
  assert.deepEqual(usdt.decimals, { value: 6, proof: true, source: 'Helios' })
  assert.equal(usdt.claimed, 7n)
  assert.deepEqual(adai.amount, { value: 100n, proof: false, source: 'Blockscout' })
  assert.deepEqual(adai.decimals, { value: 18, proof: false, source: 'Blockscout' })
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
            asked: [],
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
          asked: [],
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
      hits: { ok: true, value: { hits: [], missing: [], asked: [] } },
      deployer: { ...emptyHolder(), hits: { ok: true, value: { hits: [ofac], missing: [], asked: [] } } },
    }),
  )
  assert.deepEqual(profile.blocked, [
    { value: 'sanctioned · ETH', proof: false, source: 'OFAC sanctions', of: 'deployer' },
  ])
  assert.deepEqual(known(profile.deployer.lists).value.hits, [ofac])
  assert.ok(profile.sources.includes('OFAC sanctions'))
})

test('a scam mark of Blockscout on the deployer is in blocked and names the deployer', () => {
  const profile = buildProfile(
    reads({
      sourcify: { deployment, creation: creation(true), read: true },
      deployer: { ...emptyHolder(), blockscout: { address: blockscoutAddress({ scam: true }) } },
    }),
  )
  assert.deepEqual(profile.blocked, [{ value: 'marked as scam', proof: false, source: 'Blockscout', of: 'deployer' }])
})

test('a list without data is missing, not a list that does not know the address', () => {
  const missing = [{ list: 'OFAC sanctions', reason: 'HTTP 503' }]
  const profile = buildProfile(reads({ hits: { ok: true, value: { hits: [], missing, asked: [] } } }))
  assert.deepEqual(known(profile.lists).value, { hits: [], missing, asked: [] })
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
    hits: { ok: true, value: { hits: [ofac], missing: [], asked: [] } },
    goPlus: 'off',
    done: true,
  })
  assert.deepEqual(account, {
    address: DEPLOYER,
    chainId: 1,
    lists: { state: 'known', value: { hits: [ofac], missing: [], asked: [] }, proof: false, source: 'address lists' },
    blocked: [{ value: 'sanctioned · ETH', proof: false, source: 'OFAC sanctions', of: 'address' }],
    goPlus: { state: 'off' },
    sources: ['OFAC sanctions'],
  })
  const waiting = buildAccount({ address: DEPLOYER, chainId: 1, done: false })
  assert.deepEqual(
    [waiting.lists, waiting.goPlus],
    [
      { state: 'pending', source: LISTS },
      { state: 'pending', source: 'GoPlus' },
    ],
  )
})

test('young: the age in days under 30 days, else null', () => {
  const at = (days: number) => ({ state: 'known' as const, value: NOW - days * DAY, proof: true, source: 'Helios' })
  assert.equal(young(at(3), NOW), 3)
  assert.equal(young(at(0), NOW), 0)
  assert.equal(young(at(YOUNG_DAYS), NOW), null)
  assert.equal(young(at(400), NOW), null)
  assert.equal(young({ state: 'pending', source: CHAIN }, NOW), null)
  const profile = buildProfile(
    reads({
      sourcify: { deployment, creation: creation(true), read: true },
      blockTime: { ok: true, value: { value: NOW - 2 * DAY, proof: true } },
    }),
  )
  assert.equal(profile.young, 2)
})
