import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Interface } from 'ethers'
import { decodeCalldata, decodeEvent, decodeStandardEvent, rawWords, selectorOf } from '../src/clear-signing/decode.ts'
import type { Hex } from '../src/messages.ts'

const ALICE = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

const ERC20_ABI = ['function transfer(address to, uint256 value) returns (bool)']

const SWAP_ABI = [
  'function swap(uint256 amountOutMin, address[] path, (uint8 kind, bytes extra) order, bool exact, string note)',
]

// The JSON ABI, as the compiler gives it.
const json = (human: string[]) => JSON.parse(new Interface(human).formatJson()) as unknown[]

test('decodeCalldata names the parameters and renders each value in words', () => {
  const data = new Interface(ERC20_ABI).encodeFunctionData('transfer', [ALICE, 250_000_000n]) as Hex
  const decoded = decodeCalldata(json(ERC20_ABI), data)
  assert.deepEqual(decoded, {
    selector: '0xa9059cbb',
    name: 'transfer',
    signature: 'transfer(address to, uint256 value)',
    params: [
      { name: 'to', type: 'address', value: ALICE },
      { name: 'value', type: 'uint256', value: '250000000' },
    ],
  })
})

test('decodeCalldata renders arrays, tuples, strings, and booleans', () => {
  const contract = new Interface(SWAP_ABI)
  const data = contract.encodeFunctionData('swap', [1n, [ALICE, ALICE], [3, '0x1234'], true, 'hi "there"']) as Hex
  const decoded = decodeCalldata(json(SWAP_ABI), data)
  assert.equal(
    decoded?.signature,
    'swap(uint256 amountOutMin, address[] path, (uint8 kind, bytes extra) order, bool exact, string note)',
  )
  assert.deepEqual(
    decoded?.params.map((param) => param.value),
    ['1', `[${ALICE}, ${ALICE}]`, '{ kind: 3, extra: 0x1234 }', 'true', '"hi \\"there\\""'],
  )
})

test('decodeCalldata gives null for an unknown selector, short calldata, or a broken ABI', () => {
  assert.equal(decodeCalldata(json(ERC20_ABI), '0x12345678'), null)
  assert.equal(decodeCalldata(json(ERC20_ABI), '0xa9059cbb0000'), null)
  assert.equal(decodeCalldata([{ type: 'function', inputs: 'no' }], '0xa9059cbb'), null)
})

test('rawWords splits the calldata after the selector into 32-byte words', () => {
  const word = (n: number) => n.toString(16).padStart(64, '0')
  assert.deepEqual(rawWords(`0xA9059CBB${word(1)}${word(2)}` as Hex), {
    selector: '0xa9059cbb',
    words: [word(1), word(2)],
  })
  assert.deepEqual(rawWords('0xa9059cbb'), { selector: '0xa9059cbb', words: [] })
  assert.deepEqual(rawWords(`0xa9059cbb${word(1)}ff` as Hex), { selector: '0xa9059cbb', words: [word(1), 'ff'] })
  assert.equal(rawWords('0x1234'), null)
})

test('selectorOf takes the first four bytes', () => {
  assert.equal(selectorOf('0xA9059CBB00'), '0xa9059cbb')
  assert.equal(selectorOf('0xa905'), null)
  assert.equal(selectorOf('0x'), null)
})

test('decodeEvent names the values of a log with the verified ABI', () => {
  const abi = [
    'event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)',
  ]
  const event = new Interface(abi).getEvent('VoteCast')!
  const log = new Interface(abi).encodeEventLog(event, [ALICE, 12n, 1, 7472n, 'yes'])
  assert.deepEqual(decodeEvent(abi, { topics: log.topics as Hex[], data: log.data as Hex }), {
    name: 'VoteCast',
    params: [
      { name: 'voter', type: 'address', value: ALICE },
      { name: 'proposalId', type: 'uint256', value: '12' },
      { name: 'support', type: 'uint8', value: '1' },
      { name: 'weight', type: 'uint256', value: '7472' },
      { name: 'reason', type: 'string', value: '"yes"' },
    ],
  })
  // Another event, or a log with another count of topics, does not decode.
  assert.equal(decodeEvent(ERC20_ABI, { topics: log.topics as Hex[], data: log.data as Hex }), null)
  assert.equal(decodeEvent(abi, { topics: log.topics.slice(0, 1) as Hex[], data: log.data as Hex }), null)
})

test('decodeStandardEvent tells the Transfer of an ERC-20 from the one of an ERC-721', () => {
  const erc20 = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)'])
  const erc721 = new Interface(['event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'])
  const a = erc20.encodeEventLog(erc20.getEvent('Transfer')!, [ALICE, ALICE, 5n])
  const b = erc721.encodeEventLog(erc721.getEvent('Transfer')!, [ALICE, ALICE, 7n])
  assert.deepEqual(decodeStandardEvent({ topics: a.topics as Hex[], data: a.data as Hex })?.params.at(-1), {
    name: 'value',
    type: 'uint256',
    value: '5',
  })
  assert.deepEqual(decodeStandardEvent({ topics: b.topics as Hex[], data: b.data as Hex })?.params.at(-1), {
    name: 'tokenId',
    type: 'uint256',
    value: '7',
  })
  assert.equal(decodeStandardEvent({ topics: [`0x${'11'.repeat(32)}`], data: '0x' }), null)
})
