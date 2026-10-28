import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createAddressFromString, hexToBytes, bytesToHex, setLengthLeft, Account } from '@ethereumjs/util'
import type { ChainRead } from '../src/gates/helios.ts'
import { ChainStateManager } from '../src/gates/state.ts'

const A = createAddressFromString('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
const B = createAddressFromString('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
const EMPTY_CODE_HASH = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
const HASH_1 = `0x${'12'.repeat(32)}`
const HASH_2 = `0x${'34'.repeat(32)}`
const SLOT = setLengthLeft(hexToBytes('0x01'), 32)

// A chain with one contract at A and nothing at B. It records what it
// was asked.
function chain(): ChainRead & { calls: string[] } {
  const calls: string[] = []
  const read: ChainRead = async (method, params) => {
    calls.push(`${method} ${params.join(' ')}`)
    const address = String(params[0])
    switch (method) {
      case 'eth_getProof':
        if (address === A.toString())
          return { nonce: '0x1', balance: '0xde0b6b3a7640000', codeHash: HASH_1, storageHash: HASH_2 }
        return { nonce: '0x0', balance: '0x0', codeHash: EMPTY_CODE_HASH, storageHash: HASH_2 }
      case 'eth_getCode':
        return address === A.toString() ? '0x6001' : '0x'
      case 'eth_getStorageAt':
        return `0x${'00'.repeat(31)}2a`
      default:
        throw new Error(`${method} not expected`)
    }
  }
  return Object.assign(read, { calls })
}

test('an account is read once with eth_getProof at the block, and kept', async () => {
  const read = chain()
  const state = new ChainStateManager(read, 255)
  const account = await state.getAccount(A)
  assert.equal(account?.nonce, 1n)
  assert.equal(account?.balance, 10n ** 18n)
  await state.getAccount(A)
  assert.deepEqual(read.calls, [`eth_getProof ${A} ${[]} 0xff`])
  assert.deepEqual(state.reads, { accounts: 1, slots: 0 })
})

test('an address the chain does not know has no account', async () => {
  const state = new ChainStateManager(chain(), 1)
  assert.equal(await state.getAccount(B), undefined)
  assert.equal(await state.getAccount(B), undefined)
  assert.equal(state.reads.accounts, 1)
})

test('the code is read once, and remembered as the chain gave it', async () => {
  const read = chain()
  const state = new ChainStateManager(read, 1)
  assert.equal(bytesToHex(await state.getCode(A)), '0x6001')
  assert.equal(await state.getCodeSize(A), 2)
  assert.equal(bytesToHex(await state.getCode(B)), '0x')
  await state.putCode(A, hexToBytes('0x6002'))
  assert.equal(bytesToHex(await state.getCode(A)), '0x6002')
  assert.deepEqual(
    [...state.codes],
    [
      [A.toString(), '0x6001'],
      [B.toString(), '0x'],
    ],
  )
  assert.equal(read.calls.filter((call) => call.startsWith('eth_getCode')).length, 2)
})

test('a storage slot comes without leading zeros, and is read once', async () => {
  const read = chain()
  const state = new ChainStateManager(read, 1)
  assert.equal(bytesToHex(await state.getStorage(A, SLOT)), '0x2a')
  assert.equal(bytesToHex(await state.getStorage(A, SLOT)), '0x2a')
  assert.deepEqual(read.calls, [`eth_getStorageAt ${A} ${bytesToHex(SLOT)} 0x1`])
  assert.equal(state.reads.slots, 1)
  await assert.rejects(state.getStorage(A, hexToBytes('0x01')), /32 bytes/)
})

test('a reverted checkpoint gives the value of the chain back, a committed one keeps the write', async () => {
  const state = new ChainStateManager(chain(), 1)
  await state.checkpoint()
  await state.putStorage(A, SLOT, hexToBytes('0x07'))
  assert.equal(bytesToHex(await state.getStorage(A, SLOT)), '0x07')
  await state.revert()
  assert.equal(bytesToHex(await state.getStorage(A, SLOT)), '0x2a')
  await state.checkpoint()
  await state.putStorage(A, SLOT, hexToBytes('0x07'))
  await state.commit()
  assert.equal(bytesToHex(await state.getStorage(A, SLOT)), '0x07')
  assert.equal(state.reads.slots, 1)
})

test('account writes: put, modify, delete', async () => {
  const state = new ChainStateManager(chain(), 1)
  await state.modifyAccountFields(A, { balance: 5n })
  assert.equal((await state.getAccount(A))?.balance, 5n)
  assert.equal((await state.getAccount(A))?.nonce, 1n)
  await state.modifyAccountFields(B, { nonce: 3n })
  assert.equal((await state.getAccount(B))?.nonce, 3n)
  await state.putAccount(A, new Account(9n, 0n))
  assert.equal((await state.getAccount(A))?.nonce, 9n)
  await state.deleteAccount(A)
  assert.equal(await state.getAccount(A), undefined)
})

test('a read at a block the node does not know yet is tried again after a pause, three times', async () => {
  // The first two answers come from a node behind the head.
  let lagging = 2
  const calls: string[] = []
  const read: ChainRead = async (method, params) => {
    calls.push(method)
    if (lagging-- > 0) throw new Error(`${method}: header not found`)
    return chain()(method, params)
  }
  const slept: number[] = []
  const state = new ChainStateManager(read, 255, async (ms) => void slept.push(ms))
  assert.equal((await state.getAccount(A))?.nonce, 1n)
  assert.deepEqual(calls, ['eth_getProof', 'eth_getProof', 'eth_getProof'])
  assert.deepEqual(slept, [1000, 1000])
  // A node that stays behind gives up after the third retry; any other
  // error is not retried.
  const behind: ChainRead = async (method) => {
    calls.push(method)
    throw new Error(`${method}: unknown block`)
  }
  calls.length = 0
  await assert.rejects(new ChainStateManager(behind, 1, async () => {}).getCode(A), /eth_getCode: unknown block/)
  assert.equal(calls.length, 4)
  calls.length = 0
  const broken: ChainRead = async (method) => {
    calls.push(method)
    throw new Error(`${method}: the endpoint answered HTTP 429`)
  }
  await assert.rejects(new ChainStateManager(broken, 1, async () => {}).getStorage(A, SLOT), /HTTP 429/)
  assert.equal(calls.length, 1)
})

test('an answer of another shape is refused', async () => {
  const bad: ChainRead = async (method) => (method === 'eth_getProof' ? { nonce: 1 } : 42)
  const state = new ChainStateManager(bad, 1)
  await assert.rejects(state.getAccount(A), /eth_getProof gave an unexpected answer/)
  await assert.rejects(state.getCode(A), /eth_getCode gave an unexpected answer/)
  await assert.rejects(state.getStorage(A, SLOT), /eth_getStorageAt gave an unexpected answer/)
})
