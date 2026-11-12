import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Interface } from 'ethers'
import type { Hex } from '../src/messages.ts'
import type { Contract } from '../src/gates/contracts.ts'
import { TOPICS, type Effects, type Permission } from '../src/gates/effects.ts'
import type { Simulation } from '../src/gates/simulation.ts'
import type { Verified } from '../src/gates/verify.ts'
import {
  allowanceText,
  assetText,
  balanceText,
  codesOn,
  eventRows,
  feeNote,
  feeOf,
  isUnlimited,
  nameOf,
  otherContracts,
  sourceOf,
  stateChanges,
  warningText,
} from '../src/simulationCard.ts'

const YOU: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const PROXY: Hex = '0x1000000000000000000000000000000000000001'
const IMPL: Hex = '0x2000000000000000000000000000000000000002'
const POOL: Hex = '0x3000000000000000000000000000000000000003'
const SPENDER: Hex = '0x4000000000000000000000000000000000000004'
const MAX = (1n << 256n) - 1n
const word = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}` as Hex

const tokenAbi = ['event Transfer(address indexed from, address indexed to, uint256 value)']
const layout = {
  storage: [{ label: 'paused', slot: '3', offset: 0, type: 't_bool' }],
  types: { t_bool: { encoding: 'inplace', label: 'bool', numberOfBytes: '1' } },
}

function contract(address: Hex, name: string | null, extra: Partial<Verified> = {}): Contract {
  const value = {
    claim: { name } as Verified['claim'],
    runtimeMatch: 'perfect',
    creationMatch: null,
    creationNote: null,
    creation: null,
    transformations: { runtime: { list: [], values: {} }, creation: { list: [], values: {} } },
    abi: [],
    ...extra,
  } satisfies Verified
  return {
    address,
    foundBy: 'simulation',
    helios: { status: 'passed', value: { address, block: 1, code: '0x60' } },
    sourcify: name === null ? { status: 'failed', reason: 'not verified' } : { status: 'passed', value },
  }
}

const transfer = new Interface(tokenAbi).encodeEventLog('Transfer', [POOL, YOU, 5n])

// A swap through a proxy token: the code of IMPL ran on the storage of
// PROXY. The pool wrote a slot too.
const simulation: Simulation = {
  header: {
    number: 100,
    timestamp: 0,
    gasLimit: 0n,
    baseFee: 10n,
    coinbase: POOL,
    prevRandao: '0x',
    excessBlobGas: null,
  },
  calls: [
    {
      call: { from: YOU, to: POOL, data: '0x12345678', value: 0n, gas: null },
      frames: [],
      error: null,
      logs: [
        { address: PROXY, topics: transfer.topics as Hex[], data: transfer.data as Hex },
        { address: POOL, topics: [`0x${'99'.repeat(32)}`], data: '0x' },
      ],
      gas: 50_000n,
    },
  ],
  touched: [
    { address: POOL, block: 100, code: '0x60', contexts: [POOL] },
    { address: PROXY, block: 100, code: '0x60', contexts: [PROXY] },
    { address: IMPL, block: 100, code: '0x60', contexts: [PROXY] },
  ],
  reads: { accounts: 3, slots: 4 },
  diff: {
    accounts: [{ address: YOU, balance: { before: 10n, after: 10n }, nonce: { before: 1n, after: 2n } }],
    slots: [
      { address: PROXY, slot: word(7n), before: word(0n), after: word(5n) },
      { address: PROXY, slot: word(3n), before: word(0n), after: word(1n) },
      { address: POOL, slot: word(8n), before: word(1n), after: word(2n) },
    ],
  },
  fee: { gas: 50_000n, price: 10n, fromRequest: false },
  effects: { status: 'skipped', reason: 'not in this test' },
}

const contracts = [
  contract(POOL, null),
  contract(PROXY, 'TokenProxy'),
  contract(IMPL, 'Token', { abi: tokenAbi, storageLayout: layout }),
]

const tokens: Effects['tokens'] = {
  [PROXY]: { symbol: 'TKN', name: 'Token', decimals: 6 },
  [POOL]: { symbol: null, name: null, decimals: null },
}

test('codesOn: the implementation first, then the own code', () => {
  assert.deepEqual(codesOn(PROXY, simulation), [IMPL, PROXY])
  assert.deepEqual(codesOn(POOL, simulation), [POOL])
})

test('names and sources: you, the name of verified code, nothing for the rest', () => {
  assert.equal(nameOf(YOU, contracts, YOU), 'you')
  assert.equal(nameOf(PROXY, contracts, YOU), 'TokenProxy')
  assert.equal(nameOf(POOL, contracts, YOU), null)
  assert.equal(sourceOf(PROXY, contracts), 'verified')
  assert.equal(sourceOf(POOL, contracts), 'unverified')
  assert.equal(sourceOf(SPENDER, contracts), 'unverified')
  const waiting = { ...contract(SPENDER, 'X'), sourcify: { status: 'running' } } as Contract
  assert.equal(sourceOf(SPENDER, [waiting]), 'pending')
})

test('assetText: ETH, a token, an NFT, a count of NFTs, and a token with no symbol', () => {
  const asset = (change: Parameters<typeof assetText>[0]) => assetText(change, tokens)
  assert.equal(asset({ asset: { kind: 'native' }, delta: -(15n * 10n ** 17n) }), '1.5 ETH')
  assert.equal(asset({ asset: { kind: 'erc20', token: PROXY }, delta: 2_500_000n }), '2.5 TKN')
  const nft = { kind: 'nft', standard: 'erc721', token: PROXY, id: 3941n } as const
  assert.equal(asset({ asset: nft, delta: -1n }), 'TKN #3941')
  assert.equal(asset({ asset: { ...nft, standard: 'erc1155' }, delta: 3n }), '3 × TKN #3941')
  assert.equal(asset({ asset: { ...nft, id: null }, delta: 2n }), '2 TKN NFTs')
  assert.equal(asset({ asset: { kind: 'erc20', token: POOL }, delta: 7n }), '7 0x3000…0003')
})

test('allowances: unlimited in words, an amount, all of a collection, one NFT, and a revoke', () => {
  const base: Permission = {
    token: PROXY,
    spender: SPENDER,
    kind: 'amount',
    before: 0n,
    after: MAX,
    balance: 250_000_000n,
  }
  assert.equal(allowanceText(base, tokens), 'Unlimited TKN')
  assert.equal(isUnlimited(base), true)
  assert.equal(balanceText(base, tokens), '250 TKN')
  assert.equal(allowanceText({ ...base, after: 1_000_000n }, tokens), '1 TKN')
  assert.equal(isUnlimited({ ...base, after: 1_000_000n }), false)
  assert.equal(allowanceText({ ...base, kind: 'all', after: 1n, balance: 3n }, tokens), 'All your TKN')
  assert.equal(balanceText({ ...base, kind: 'all', after: 1n, balance: 3n }, tokens), '3 TKN')
  assert.equal(allowanceText({ ...base, kind: 'one', after: 1n, id: 7n }, tokens), 'TKN #7')
  assert.equal(allowanceText({ ...base, after: 0n }, tokens), 'TKN')
  assert.equal(balanceText({ ...base, balance: null }, tokens), null)
})

test('warningText: what the event claims', () => {
  assert.equal(
    warningText({ token: PROXY, direction: 'in', amount: 5_000_000_000n, id: null }, tokens),
    'An event says that you receive 5,000 TKN, but your balance does not change',
  )
  assert.equal(
    warningText({ token: PROXY, direction: 'out', amount: null, id: 9n }, tokens),
    'An event says that you send TKN #9, but your balance does not change',
  )
})

test('otherContracts: the written contracts that the rows do not explain', () => {
  const effects: Effects = {
    you: YOU,
    assets: [{ asset: { kind: 'erc20', token: PROXY }, delta: 5n }],
    permissions: [],
    tokens,
    warnings: [],
    probes: 2,
  }
  assert.deepEqual(otherContracts(simulation, effects), [POOL])
  assert.deepEqual(otherContracts(simulation, null), [PROXY, POOL])
})

test('stateChanges: the slots of a proxy named with the layout of its implementation', () => {
  const [proxy, pool] = stateChanges(simulation, contracts)
  assert.equal(proxy.address, PROXY)
  assert.deepEqual(
    proxy.slots.map((slot) => slot.variables),
    [[], [{ name: 'paused', type: 'bool', before: 'false', after: 'true' }]],
  )
  assert.deepEqual(pool.slots[0].variables, [])
})

test('eventRows: the verified ABI of the implementation, else nothing', () => {
  const [token, pool] = eventRows(simulation, contracts)
  assert.equal(token.decoded?.name, 'Transfer')
  assert.equal(token.standard, false)
  assert.equal(token.log.topics[0], TOPICS.transfer)
  assert.deepEqual(pool, { log: simulation.calls[0].logs[1], decoded: null, standard: false })
  // Without the verified ABI, a token event decodes with the standard.
  const [standard] = eventRows(simulation, [contract(PROXY, null)])
  assert.equal(standard.decoded?.name, 'Transfer')
  assert.equal(standard.standard, true)
})

test('the fee: the gas times the price, and how the price was chosen', () => {
  assert.equal(feeOf(simulation), 500_000n)
  assert.equal(
    feeNote(simulation),
    '50,000 gas at the base fee of block 100. Your wallet adds a tip, so the fee is a little higher.',
  )
  assert.equal(
    feeNote({ ...simulation, fee: { ...simulation.fee, fromRequest: true } }),
    '50,000 gas at the gas price of the request.',
  )
})
