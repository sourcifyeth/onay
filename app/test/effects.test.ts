// The effects with a fake probe: a table of the answers of the tokens on
// the state before the run and after it.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AbiCoder, Interface, zeroPadValue } from 'ethers'
import type { Hex } from '../src/messages.ts'
import { effectsOf, MAX_TOKENS, TOPICS, type EventLog, type Probe } from '../src/gates/effects.ts'
import type { Call } from '../src/gates/request.ts'
import type { StateDiff } from '../src/gates/state.ts'

const YOU: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const ALICE: Hex = '0xa11ce00000000000000000000000000000000001'
const TOKEN: Hex = '0x1000000000000000000000000000000000000001'
const NFT: Hex = '0x2000000000000000000000000000000000000002'
const MULTI: Hex = '0x3000000000000000000000000000000000000003'
const POOL: Hex = '0x4000000000000000000000000000000000000004'
const SPENDER: Hex = '0x5000000000000000000000000000000000000005'
const ZERO: Hex = '0x0000000000000000000000000000000000000000'
const MAX = (1n << 256n) - 1n

const abi = new Interface([
  'function balanceOf(address) view returns (uint256)',
  'function balanceOf(address,uint256) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function allowance(address,address) view returns (uint256)',
  'function getApproved(uint256) view returns (address)',
  'function isApprovedForAll(address,address) view returns (bool)',
  'function supportsInterface(bytes4) view returns (bool)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function transfer(address,uint256)',
  'function safeTransferFrom(address,address,uint256)',
])
const coder = AbiCoder.defaultAbiCoder()
const data = (signature: string, args: unknown[] = []) => abi.encodeFunctionData(signature, args) as Hex
const out = (type: string, value: unknown) => coder.encode([type], [value]) as Hex
const topic = (address: Hex) => zeroPadValue(address, 32) as Hex
const uintTopic = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}` as Hex

type Answers = Record<string, Hex>

// A probe that answers from the table, and counts the questions.
function probeOf(answers: Answers): Probe & { asked: string[] } {
  const asked: string[] = []
  const probe: Probe = async (to, input, when) => {
    asked.push(`${when} ${to} ${input}`)
    return answers[`${when} ${to} ${input}`] ?? answers[`any ${to} ${input}`] ?? null
  }
  return Object.assign(probe, { asked })
}

// The answers of a token that says what it is.
function described(token: Hex, symbol: string, decimals: number | null): Answers {
  const answers: Answers = {
    [`any ${token} ${data('symbol')}`]: out('string', symbol),
    [`any ${token} ${data('name')}`]: out('string', `${symbol} Token`),
  }
  if (decimals !== null) answers[`any ${token} ${data('decimals')}`] = out('uint8', decimals)
  return answers
}

const balance = (token: Hex, before: bigint, after: bigint): Answers => ({
  [`before ${token} ${data('balanceOf(address)', [YOU])}`]: out('uint256', before),
  [`after ${token} ${data('balanceOf(address)', [YOU])}`]: out('uint256', after),
})

const call = (to: Hex, input: Hex = '0x', value = 0n): Call => ({ from: YOU, to, data: input, value, gas: null })
const noDiff: StateDiff = { accounts: [], slots: [] }
const slotAt = (address: Hex) => ({ address, slot: uintTopic(1n), before: uintTopic(0n), after: uintTopic(1n) })

const transferLog = (token: Hex, from: Hex, to: Hex, amount: bigint): EventLog => ({
  address: token,
  topics: [TOPICS.transfer, topic(from), topic(to)],
  data: uintTopic(amount),
})

test('a swap: the ETH out from the diff, the token in from balanceOf before and after', async () => {
  const diff: StateDiff = {
    accounts: [
      { address: YOU, balance: { before: 3n * 10n ** 18n, after: 2n * 10n ** 18n }, nonce: { before: 1n, after: 2n } },
    ],
    slots: [slotAt(TOKEN), slotAt(POOL)],
  }
  const logs = [transferLog(TOKEN, POOL, YOU, 500n)]
  const probe = probeOf({ ...balance(TOKEN, 100n, 600n), ...described(TOKEN, 'USDC', 6) })
  const effects = await effectsOf({ you: YOU, calls: [call(POOL, '0x12345678', 10n ** 18n)], logs, diff }, probe)
  assert.deepEqual(effects.assets, [
    { asset: { kind: 'native' }, delta: -(10n ** 18n) },
    { asset: { kind: 'erc20', token: TOKEN }, delta: 500n },
  ])
  assert.deepEqual(effects.tokens[TOKEN], { symbol: 'USDC', name: 'USDC Token', decimals: 6 })
  assert.deepEqual(effects.permissions, [])
  assert.deepEqual(effects.warnings, [])
  // The pool does not answer balanceOf: no change there.
  assert.ok(probe.asked.includes(`before ${POOL} ${data('balanceOf(address)', [YOU])}`))
  assert.equal(effects.probes, probe.asked.length)
})

test('the balance is what counts, not the amount of the event', async () => {
  // A token with a fee on each transfer: the event says 500, 490 arrive.
  const logs = [transferLog(TOKEN, POOL, YOU, 500n)]
  const probe = probeOf({ ...balance(TOKEN, 0n, 490n), ...described(TOKEN, 'FEE', 18) })
  const effects = await effectsOf({ you: YOU, calls: [call(POOL, '0x12345678')], logs, diff: noDiff }, probe)
  assert.deepEqual(effects.assets, [{ asset: { kind: 'erc20', token: TOKEN }, delta: 490n }])
  assert.deepEqual(effects.warnings, [])
})

test('a plain token transfer names the receiver', async () => {
  const input = data('transfer', [ALICE, 250n])
  const probe = probeOf({ ...balance(TOKEN, 1000n, 750n), ...described(TOKEN, 'USDC', 6) })
  const logs = [transferLog(TOKEN, YOU, ALICE, 250n)]
  const effects = await effectsOf({ you: YOU, calls: [call(TOKEN, input)], logs, diff: noDiff }, probe)
  assert.deepEqual(effects.assets, [{ asset: { kind: 'erc20', token: TOKEN }, delta: -250n, counterparty: ALICE }])
})

test('a plain ETH transfer names the receiver, and an address without code is no token', async () => {
  const diff: StateDiff = {
    accounts: [
      { address: YOU, balance: { before: 10n, after: 4n }, nonce: { before: 0n, after: 1n } },
      { address: ALICE, balance: { before: 0n, after: 6n }, nonce: { before: 0n, after: 0n } },
    ],
    slots: [],
  }
  // An address without code returns no data.
  const probe = probeOf({ [`any ${ALICE} ${data('balanceOf(address)', [YOU])}`]: '0x' })
  const effects = await effectsOf({ you: YOU, calls: [call(ALICE, '0x', 6n)], logs: [], diff }, probe)
  assert.deepEqual(effects.assets, [{ asset: { kind: 'native' }, delta: -6n, counterparty: ALICE }])
})

test('a batch names no receiver: the calls together do more than one transfer', async () => {
  const input = data('transfer', [ALICE, 250n])
  const probe = probeOf({ ...balance(TOKEN, 1000n, 750n), ...described(TOKEN, 'USDC', 6) })
  const logs = [transferLog(TOKEN, YOU, ALICE, 250n)]
  const effects = await effectsOf({ you: YOU, calls: [call(TOKEN, input), call(POOL)], logs, diff: noDiff }, probe)
  assert.equal(effects.assets[0].counterparty, undefined)
})

test('an approval: the allowance before and after, and the balance next to it', async () => {
  const logs: EventLog[] = [
    { address: TOKEN, topics: [TOPICS.approval, topic(YOU), topic(SPENDER)], data: uintTopic(MAX) },
  ]
  const probe = probeOf({
    [`before ${TOKEN} ${data('allowance', [YOU, SPENDER])}`]: out('uint256', 0n),
    [`after ${TOKEN} ${data('allowance', [YOU, SPENDER])}`]: out('uint256', MAX),
    ...balance(TOKEN, 250n, 250n),
    ...described(TOKEN, 'USDC', 6),
  })
  const effects = await effectsOf(
    { you: YOU, calls: [call(TOKEN, '0x095ea7b3')], logs, diff: { accounts: [], slots: [slotAt(TOKEN)] } },
    probe,
  )
  assert.deepEqual(effects.assets, [])
  assert.deepEqual(effects.permissions, [
    { token: TOKEN, spender: SPENDER, kind: 'amount', before: 0n, after: MAX, balance: 250n },
  ])
  assert.equal(effects.tokens[TOKEN]?.symbol, 'USDC')
})

test('an approval event of another owner, or with no change of the allowance, gives nothing', async () => {
  const logs: EventLog[] = [
    { address: TOKEN, topics: [TOPICS.approval, topic(ALICE), topic(SPENDER)], data: uintTopic(MAX) },
    { address: TOKEN, topics: [TOPICS.approval, topic(YOU), topic(SPENDER)], data: uintTopic(5n) },
  ]
  const probe = probeOf({ [`any ${TOKEN} ${data('allowance', [YOU, SPENDER])}`]: out('uint256', 5n) })
  const effects = await effectsOf({ you: YOU, calls: [call(TOKEN, '0x095ea7b3')], logs, diff: noDiff }, probe)
  assert.deepEqual(effects.permissions, [])
})

test('an approval for all the NFTs, hidden in a call that names another contract', async () => {
  const logs: EventLog[] = [
    {
      address: NFT,
      topics: [TOPICS.approvalForAll, topic(YOU), topic(SPENDER)],
      data: uintTopic(1n),
    },
  ]
  const probe = probeOf({
    [`before ${NFT} ${data('isApprovedForAll', [YOU, SPENDER])}`]: out('bool', false),
    [`after ${NFT} ${data('isApprovedForAll', [YOU, SPENDER])}`]: out('bool', true),
    [`after ${NFT} ${data('balanceOf(address)', [YOU])}`]: out('uint256', 3n),
    ...described(NFT, 'BAYC', null),
  })
  const effects = await effectsOf({ you: YOU, calls: [call(POOL, '0x4e71d92d')], logs, diff: noDiff }, probe)
  assert.deepEqual(effects.permissions, [
    { token: NFT, spender: SPENDER, kind: 'all', before: 0n, after: 1n, balance: 3n },
  ])
  assert.deepEqual(effects.tokens[NFT], { symbol: 'BAYC', name: 'BAYC Token', decimals: null })
})

test('the approval of one NFT counts, the clear of it on a transfer does not', async () => {
  const logs: EventLog[] = [
    { address: NFT, topics: [TOPICS.approval, topic(YOU), topic(SPENDER), uintTopic(7n)], data: '0x' },
    { address: NFT, topics: [TOPICS.approval, topic(YOU), topic(ZERO), uintTopic(8n)], data: '0x' },
  ]
  const probe = probeOf({
    [`before ${NFT} ${data('getApproved', [7n])}`]: out('address', ZERO),
    [`after ${NFT} ${data('getApproved', [7n])}`]: out('address', SPENDER),
    [`after ${NFT} ${data('balanceOf(address)', [YOU])}`]: out('uint256', 1n),
  })
  const effects = await effectsOf({ you: YOU, calls: [call(NFT, '0x095ea7b3')], logs, diff: noDiff }, probe)
  assert.deepEqual(effects.permissions, [
    { token: NFT, spender: SPENDER, kind: 'one', before: 0n, after: 1n, id: 7n, balance: 1n },
  ])
})

test('an NFT sent: ownerOf before and after, and the receiver of safeTransferFrom', async () => {
  const logs: EventLog[] = [
    { address: NFT, topics: [TOPICS.transfer, topic(YOU), topic(ALICE), uintTopic(3941n)], data: '0x' },
  ]
  const probe = probeOf({
    [`before ${NFT} ${data('ownerOf', [3941n])}`]: out('address', YOU),
    [`after ${NFT} ${data('ownerOf', [3941n])}`]: out('address', ALICE),
  })
  const input = data('safeTransferFrom', [YOU, ALICE, 3941n])
  const effects = await effectsOf({ you: YOU, calls: [call(NFT, input)], logs, diff: noDiff }, probe)
  assert.deepEqual(effects.assets, [
    { asset: { kind: 'nft', standard: 'erc721', token: NFT, id: 3941n }, delta: -1n, counterparty: ALICE },
  ])
  assert.deepEqual(effects.warnings, [])
})

test('an ERC-1155 transfer: balanceOf of the id before and after', async () => {
  const logs: EventLog[] = [
    {
      address: MULTI,
      topics: [TOPICS.transferSingle, topic(POOL), topic(ZERO), topic(YOU)],
      data: coder.encode(['uint256', 'uint256'], [5n, 3n]) as Hex,
    },
  ]
  const probe = probeOf({
    [`before ${MULTI} ${data('balanceOf(address,uint256)', [YOU, 5n])}`]: out('uint256', 0n),
    [`after ${MULTI} ${data('balanceOf(address,uint256)', [YOU, 5n])}`]: out('uint256', 3n),
  })
  const effects = await effectsOf({ you: YOU, calls: [call(POOL, '0x12345678')], logs, diff: noDiff }, probe)
  assert.deepEqual(effects.assets, [{ asset: { kind: 'nft', standard: 'erc1155', token: MULTI, id: 5n }, delta: 3n }])
})

test('a count of NFTs that changes with no event: an NFT with no id', async () => {
  const probe = probeOf({
    ...balance(NFT, 2n, 3n),
    [`after ${NFT} ${data('supportsInterface', ['0x80ac58cd'])}`]: out('bool', true),
  })
  const diff: StateDiff = { accounts: [], slots: [slotAt(NFT)] }
  const effects = await effectsOf({ you: YOU, calls: [call(POOL, '0x12345678')], logs: [], diff }, probe)
  assert.deepEqual(effects.assets, [{ asset: { kind: 'nft', standard: 'erc721', token: NFT, id: null }, delta: 1n }])
})

test('a fake event: it says that you receive, and no balance changes', async () => {
  const logs = [transferLog(TOKEN, ZERO, YOU, 5_000_000_000n)]
  const probe = probeOf({ ...balance(TOKEN, 0n, 0n), ...described(TOKEN, 'USDC', 6) })
  const effects = await effectsOf({ you: YOU, calls: [call(POOL, '0x4e71d92d')], logs, diff: noDiff }, probe)
  assert.deepEqual(effects.assets, [])
  assert.deepEqual(effects.warnings, [{ token: TOKEN, direction: 'in', amount: 5_000_000_000n, id: null }])
  assert.equal(effects.tokens[TOKEN]?.symbol, 'USDC')
})

test('a fake NFT event: the owner does not change', async () => {
  const logs: EventLog[] = [
    { address: NFT, topics: [TOPICS.transfer, topic(ALICE), topic(YOU), uintTopic(1n)], data: '0x' },
  ]
  const probe = probeOf({ [`any ${NFT} ${data('ownerOf', [1n])}`]: out('address', ALICE) })
  const effects = await effectsOf({ you: YOU, calls: [call(POOL, '0x4e71d92d')], logs, diff: noDiff }, probe)
  assert.deepEqual(effects.warnings, [{ token: NFT, direction: 'in', amount: null, id: 1n }])
})

test('an event of nothing, or of you to you, is no warning', async () => {
  const logs = [transferLog(TOKEN, ALICE, YOU, 0n), transferLog(TOKEN, YOU, YOU, 7n)]
  const effects = await effectsOf({ you: YOU, calls: [call(POOL)], logs, diff: noDiff }, probeOf({}))
  assert.deepEqual(effects.warnings, [])
})

test('the sender is no token, and a long list of contracts stops at the cap', async () => {
  const many = Array.from({ length: MAX_TOKENS + 5 }, (_, i) => slotAt(`0x${(i + 1).toString(16).padStart(40, '0')}`))
  const probe = probeOf({})
  await effectsOf({ you: YOU, calls: [], logs: [], diff: { accounts: [], slots: [slotAt(YOU), ...many] } }, probe)
  const asked = new Set(probe.asked.map((line) => line.split(' ')[1]))
  assert.equal(asked.has(YOU), false)
  assert.equal(asked.size, MAX_TOKENS)
})

test('the words of a token: an ABI string, a bytes32, and no control characters', async () => {
  const bytes32 = `0x${Buffer.from('MKR').toString('hex').padEnd(64, '0')}` as Hex
  const probe = probeOf({
    ...balance(TOKEN, 0n, 1n),
    [`any ${TOKEN} ${data('symbol')}`]: bytes32,
    [`any ${TOKEN} ${data('name')}`]: out('string', 'Maker‮\u0000 Token'),
    [`any ${TOKEN} ${data('decimals')}`]: out('uint256', 1000n),
  })
  const effects = await effectsOf({ you: YOU, calls: [call(TOKEN, '0x12345678')], logs: [], diff: noDiff }, probe)
  // A decimals value that no token has is no answer.
  assert.deepEqual(effects.tokens[TOKEN], { symbol: 'MKR', name: 'Maker Token', decimals: null })
})
