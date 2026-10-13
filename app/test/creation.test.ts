import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Hex } from '../src/messages.ts'
import { oldBlock, parseCreation, unknownTransaction } from '../src/gates/creation.ts'

const ADDRESS: Hex = '0x1111111111111111111111111111111111111111'
const HASH: Hex = '0xe7e0fe390354509cd08c9a0168536938600ddc552b3f7cb96030ebef62e75895'
const DEPLOYER: Hex = '0x2222222222222222222222222222222222222222'

// The shape of the JSON-RPC answers, with the fields that matter.
const TX = { hash: HASH, blockNumber: '0x5cd3b1', from: DEPLOYER, to: null, input: '0x6080604052' }
const RECEIPT = { transactionHash: HASH, blockNumber: '0x5cd3b1', transactionIndex: '0x2a', contractAddress: ADDRESS }

test('a direct deployment: the input of the transaction is the creation bytecode', () => {
  assert.deepEqual(parseCreation(ADDRESS, HASH, TX, RECEIPT, true), {
    transactionHash: HASH,
    blockNumber: 6083505,
    transactionIndex: 42,
    deployer: DEPLOYER,
    input: '0x6080604052',
    verified: true,
  })
  assert.equal(parseCreation(ADDRESS, HASH, TX, RECEIPT, false).verified, false)
})

test('the receipt names the contract in another case: still a direct deployment', () => {
  const receipt = { ...RECEIPT, contractAddress: ADDRESS.toUpperCase().replace('0X', '0x') }
  assert.equal(parseCreation(ADDRESS, HASH, TX, receipt, true).input, '0x6080604052')
})

test('a transaction the chain does not know', () => {
  assert.throws(() => parseCreation(ADDRESS, HASH, null, null, true), /does not know the transaction/)
  assert.throws(() => parseCreation(ADDRESS, HASH, TX, null, true), /does not know the transaction/)
})

test('a factory deployment: the transaction created no contract, or another one', () => {
  assert.throws(() => parseCreation(ADDRESS, HASH, TX, { ...RECEIPT, contractAddress: null }, true), /another contract/)
  assert.throws(
    () => parseCreation(ADDRESS, HASH, TX, { ...RECEIPT, contractAddress: DEPLOYER }, true),
    /another contract/,
  )
})

test('unexpected answers', () => {
  assert.throws(() => parseCreation(ADDRESS, HASH, 'tx', RECEIPT, true), /unexpected transaction/)
  assert.throws(() => parseCreation(ADDRESS, HASH, TX, [], true), /unexpected receipt/)
  assert.throws(
    () => parseCreation(ADDRESS, HASH, { ...TX, blockNumber: 6083505 }, RECEIPT, true),
    /unexpected transaction/,
  )
  assert.throws(() => parseCreation(ADDRESS, HASH, { ...TX, input: 'abc' }, RECEIPT, true), /unexpected transaction/)
  assert.throws(
    () => parseCreation(ADDRESS, HASH, TX, { ...RECEIPT, transactionIndex: '42' }, true),
    /unexpected transaction/,
  )
})

test('oldBlock reads the message of Helios for a block outside the EIP-2935 window', () => {
  // core/src/execution/providers/historical/eip2935.rs
  const message = 'block 4634748 is outside EIP-2935 ring buffer range (latest: 26148103, buffer size: 8191)'
  assert.equal(oldBlock(message), '21,513,355 blocks old · Helios can verify the newest 8,191 only')
  assert.equal(oldBlock('block not found'), null)
})

test('unknownTransaction: Helios answers a hash it does not know with an error', () => {
  // core/src/execution/providers/rpc.rs
  assert.equal(unknownTransaction('receipt not found'), true)
  assert.equal(unknownTransaction('HTTP 429'), false)
})
