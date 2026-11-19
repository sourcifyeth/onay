// The names of changed slots, with the storage layout of the real
// compiler.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Hex } from '../src/messages.ts'
import { nameSlots, parseLayout, valueText } from '../src/gates/layout.ts'
import { solc, VERSION } from './solc.ts'

const SOURCE = `
pragma solidity 0.8.24;
contract Pair {
  struct Info { address owner; uint64 since; }
  uint112 public reserve0;
  uint112 public reserve1;
  uint32 public last;
  address public owner;
  bool public paused;
  int16 public delta;
  Info public info;
  uint8[5] public small;
  uint256[2] public large;
  mapping(address => uint) public balanceOf;
  uint[] public list;
}
contract Proxy {
  address public admin;
}
`

async function layouts(): Promise<Record<string, unknown>> {
  const input = {
    language: 'Solidity',
    sources: { 'src/Test.sol': { content: SOURCE } },
    settings: { outputSelection: { '*': { '*': ['storageLayout'] } } },
  }
  const output = (await solc.compile(VERSION, input, () => {})) as {
    contracts: Record<string, Record<string, { storageLayout: unknown }>>
  }
  const found: Record<string, unknown> = {}
  for (const [name, contract] of Object.entries(output.contracts['src/Test.sol'])) found[name] = contract.storageLayout
  return found
}

const A: Hex = '0x1000000000000000000000000000000000000001'
const word = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}` as Hex
const change = (slot: bigint, before: bigint, after: bigint) => ({
  address: A,
  slot: word(slot),
  before: word(before),
  after: word(after),
})

test('a packed slot: each variable that changed, by its name, and not the others', async () => {
  const { Pair } = await layouts()
  // Slot 0 holds reserve0 (14 bytes), reserve1 (14 bytes) and last (4 bytes).
  const before = 5n | (7n << 112n) | (100n << 224n)
  const after = 6n | (7n << 112n) | (160n << 224n)
  const [named] = nameSlots([Pair], [change(0n, before, after)])
  assert.deepEqual(named.variables, [
    { name: 'reserve0', type: 'uint112', before: '5', after: '6' },
    { name: 'last', type: 'uint32', before: '100', after: '160' },
  ])
})

test('an address, a bool and a signed integer in one slot', async () => {
  const { Pair } = await layouts()
  const owner = 0xabcn
  // Slot 1: owner (20 bytes), paused (1 byte), delta (2 bytes).
  const after = owner | (1n << 160n) | (0xfffen << 168n)
  const [named] = nameSlots([Pair], [change(1n, 0n, after)])
  assert.deepEqual(named.variables, [
    { name: 'owner', type: 'address', before: `0x${'0'.repeat(40)}`, after: `0x${'0'.repeat(37)}abc` },
    { name: 'paused', type: 'bool', before: 'false', after: 'true' },
    { name: 'delta', type: 'int16', before: '0', after: '-2' },
  ])
})

test('a member of a struct and the items of fixed arrays', async () => {
  const { Pair } = await layouts()
  const named = nameSlots(
    [Pair],
    [
      // info.owner and info.since share slot 2.
      change(2n, 0n, 1n << 160n),
      // small takes one slot: item 3 is the fourth byte.
      change(3n, 0n, 9n << 24n),
      // large takes slots 4 and 5.
      change(5n, 1n, 2n),
    ],
  )
  assert.deepEqual(
    named.map((slot) => slot.variables),
    [
      [{ name: 'info.since', type: 'uint64', before: '0', after: '1' }],
      [{ name: 'small[3]', type: 'uint8', before: '0', after: '9' }],
      [{ name: 'large[1]', type: 'uint256', before: '1', after: '2' }],
    ],
  )
})

test('the slot of a mapping entry or of a dynamic array stays raw', async () => {
  const { Pair } = await layouts()
  const hashed = change(0x3b990ce11dc2a5a37f328d5a2df46cf5f5d7e1fc283a61249637b83912e51dden, 1n, 2n)
  const [named] = nameSlots([Pair], [hashed])
  assert.deepEqual(named, { ...hashed, variables: [] })
})

test('the first layout that names the slot wins: the implementation before the proxy', async () => {
  const { Pair, Proxy } = await layouts()
  const [named] = nameSlots([Pair, Proxy], [change(1n, 0n, 0xabcn)])
  assert.equal(named.variables[0].name, 'owner')
  const [proxy] = nameSlots([Proxy], [change(0n, 0n, 0xabcn)])
  assert.equal(proxy.variables[0].name, 'admin')
})

test('a layout of another shape, or none, names nothing', () => {
  const slot = change(0n, 0n, 1n)
  assert.equal(parseLayout(null), null)
  assert.equal(parseLayout({ storage: [{ name: 'x' }] }), null)
  assert.deepEqual(nameSlots([null, { storage: 'no' }], [slot]), [{ ...slot, variables: [] }])
})

test('a value in words, by its type', () => {
  assert.equal(valueText(1n, 'bool', 1), 'true')
  assert.equal(valueText(0xffn, 'int8', 1), '-1')
  assert.equal(valueText(0x7fn, 'int8', 1), '127')
  assert.equal(valueText(2n, 'enum Status', 1), '2')
  assert.equal(valueText(0xabn, 'contract IERC20', 20), `0x${'0'.repeat(38)}ab`)
  assert.equal(valueText(0x1234n, 'bytes4', 4), '0x00001234')
})
