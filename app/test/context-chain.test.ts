// The chain reads of the profile, over a fake reader.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  accountState,
  balanceOfData,
  blockTime,
  codeKind,
  tokenBalance,
  type ChainAccess,
} from '../src/context/chain.ts'
import type { ChainRead } from '../src/gates/helios.ts'
import type { Hex } from '../src/messages.ts'

const HOLDER: Hex = '0x36928500bc1dcd7af6a2b4008875cc336b927d57'
const USDT: Hex = '0xdac17f958d2ee523a2206206994597c13d831ec7'

type Call = { method: string; params: unknown[] }

function reader(answer: (method: string, params: unknown[]) => unknown): { read: ChainRead; calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    read: async (method, params) => {
      calls.push({ method, params })
      return answer(method, params)
    },
  }
}

const fail: ChainRead = async () => {
  throw new Error('the fallback must not be asked')
}

const access = (read: ChainRead, proof = true, fallback = fail): ChainAccess => ({ read, fallback, proof })

test('accountState: the balance and the nonce from eth_getProof with no storage slot, at the block', async () => {
  const { read, calls } = reader(() => ({ balance: '0x9ae5c3c8b3c4b000', nonce: '0x1f', storageProof: [] }))
  assert.deepEqual(await accountState(access(read), HOLDER, 100), {
    value: { balance: 0x9ae5c3c8b3c4b000n, nonce: 31n },
    proof: true,
  })
  assert.deepEqual(calls, [{ method: 'eth_getProof', params: [HOLDER, [], '0x64'] }])
  const rpc = reader(() => ({ balance: '0x0', nonce: '0x0' }))
  assert.deepEqual(await accountState(access(rpc.read, false), HOLDER, 100), {
    value: { balance: 0n, nonce: 0n },
    proof: false,
  })
  const state = (answer: unknown) => accountState(access(reader(() => answer).read), HOLDER, 100)
  await assert.rejects(state({ balance: 7, nonce: '0x0' }), /balance did not read/)
  await assert.rejects(state({ balance: '0x0' }), /nonce did not read/)
})

test('codeKind: account, contract, or account with a delegate', async () => {
  const kind = async (code: unknown) => (await codeKind(access(reader(() => code).read), HOLDER, 1)).value
  assert.equal(await kind('0x'), 'account')
  assert.equal(await kind('0x6080604052'), 'contract')
  assert.equal(await kind(`0xef0100${'ab'.repeat(20)}`), 'delegated')
  await assert.rejects(kind(null), /no code/)
})

test('blockTime: in the window, with proof', async () => {
  const { read, calls } = reader(() => ({ number: '0x46b81c', timestamp: '0x5a1cb0d1' }))
  assert.deepEqual(await blockTime(access(read), 4634652), { value: 0x5a1cb0d1 * 1000, proof: true })
  assert.deepEqual(calls[0], { method: 'eth_getBlockByNumber', params: ['0x46b81c', false] })
})

test('blockTime: an old block comes from the endpoint without proof, with the reason', async () => {
  const helios = reader(() => {
    throw new Error('block 4634652 is outside EIP-2935 ring buffer range (latest: 23000000, buffer size: 8191)')
  })
  const endpoint = reader(() => ({ number: '0x46b81c', timestamp: '0x5a1cb0d1' }))
  const time = await blockTime(access(helios.read, true, endpoint.read), 4634652)
  assert.equal(time.value, 0x5a1cb0d1 * 1000)
  assert.equal(time.proof, false)
  assert.match(time.note ?? '', /blocks old · Helios can verify the newest 8,191 only/)
  assert.equal(endpoint.calls.length, 1)
})

test('blockTime: another error, or a wrong block, fails', async () => {
  const down = reader(() => {
    throw new Error('connection refused')
  })
  await assert.rejects(blockTime(access(down.read), 5), /connection refused/)
  const wrong = reader(() => ({ number: '0x6', timestamp: '0x1' }))
  await assert.rejects(blockTime(access(wrong.read), 5), /not block 5/)
  // RPC mode has no fallback: the reader is the endpoint.
  const rpc = reader(() => {
    throw new Error('block 5 is outside EIP-2935 ring buffer range (latest: 9000, buffer size: 8191)')
  })
  await assert.rejects(blockTime(access(rpc.read, false), 5), /outside/)
  await assert.rejects(blockTime(access(reader(() => null).read), 5), /not found/)
})

test('tokenBalance: balanceOf through eth_call at the block', async () => {
  const amount = `0x${2478410635n.toString(16).padStart(64, '0')}`
  const { read, calls } = reader(() => amount)
  assert.deepEqual(await tokenBalance(access(read, false), USDT, HOLDER, 100), { value: 2478410635n, proof: false })
  assert.deepEqual(calls, [{ method: 'eth_call', params: [{ to: USDT, data: balanceOfData(HOLDER) }, '0x64'] }])
  assert.equal(balanceOfData(HOLDER), `0x70a08231000000000000000000000000${HOLDER.slice(2)}`)
  await assert.rejects(tokenBalance(access(reader(() => '0x').read), USDT, HOLDER, 1), /no amount/)
})
