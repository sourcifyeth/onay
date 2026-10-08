import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { SigningRequest } from '../src/messages.ts'
import { chainOf, contractsOf, parseChainId, parseQuantity } from '../src/gates/request.ts'

const A = '0xff75a951eeb963dd34a1712edc3c358f08e6b0aa'
const B = '0x1111111111111111111111111111111111111111'

function request(method: string, params: unknown, chainId: number | null = null): SigningRequest {
  return {
    connection: 1,
    id: '1',
    origin: 'https://dapp.example',
    method,
    params,
    chainId,
    receivedAt: 0,
    outcome: null,
  }
}

test('parseChainId accepts numbers, decimal strings, and hex strings', () => {
  assert.equal(parseChainId(1), 1)
  assert.equal(parseChainId('137'), 137)
  assert.equal(parseChainId('0xa4b1'), 42161)
  assert.equal(parseChainId(' 0x1 '), 1)
})

test('parseChainId rejects what is not a chain id', () => {
  for (const value of [0, -1, 1.5, '', '0x', 'abc', '1e3', null, undefined, {}, [], 2 ** 53, true]) {
    assert.equal(parseChainId(value), null, String(value))
  }
})

test('contractsOf: the contract of each method', () => {
  assert.deepEqual(contractsOf(request('eth_sendTransaction', [{ to: A }])), [A])
  assert.deepEqual(contractsOf(request('eth_signTransaction', [{ to: A }])), [A])
  assert.deepEqual(contractsOf(request('wallet_sendCalls', [{ calls: [{ to: A }, { to: B }, { to: A }] }])), [A, B])
  const typed = JSON.stringify({ domain: { verifyingContract: A } })
  assert.deepEqual(contractsOf(request('eth_signTypedData_v4', ['0xabc', typed])), [A])
  assert.deepEqual(contractsOf(request('eth_signTypedData_v3', ['0xabc', { domain: { verifyingContract: B } }])), [B])
})

test('contractsOf: lowercase, no duplicates, nothing for messages or bad data', () => {
  assert.deepEqual(contractsOf(request('eth_sendTransaction', [{ to: A.toUpperCase().replace('0X', '0x') }])), [A])
  assert.deepEqual(contractsOf(request('personal_sign', ['0x68656c6c6f', A])), [])
  assert.deepEqual(contractsOf(request('eth_sign', [A, '0x68656c6c6f'])), [])
  assert.deepEqual(contractsOf(request('eth_sendTransaction', [{ to: '0x123' }])), [])
  assert.deepEqual(contractsOf(request('eth_sendTransaction', [{}])), [])
  assert.deepEqual(contractsOf(request('eth_sendTransaction', 'not a list')), [])
  assert.deepEqual(contractsOf(request('eth_signTypedData_v4', ['0xabc', '{not json'])), [])
  assert.deepEqual(contractsOf(request('wallet_sendCalls', [{ calls: 'no' }])), [])
})

test('chainOf: the wallet, the request, or both', () => {
  assert.deepEqual(chainOf(request('eth_sendTransaction', [{ to: A }], 1)), { chainId: 1, source: 'wallet' })
  assert.deepEqual(chainOf(request('eth_sendTransaction', [{ to: A, chainId: '0x1' }], 1)), {
    chainId: 1,
    source: 'wallet',
  })
  assert.deepEqual(chainOf(request('eth_sendTransaction', [{ to: A, chainId: '0x89' }])), {
    chainId: 137,
    source: 'request',
  })
  assert.deepEqual(chainOf(request('wallet_sendCalls', [{ chainId: '0xa4b1', calls: [] }])), {
    chainId: 42161,
    source: 'request',
  })
  const typed = JSON.stringify({ domain: { chainId: 11155111, verifyingContract: A } })
  assert.deepEqual(chainOf(request('eth_signTypedData_v4', ['0xabc', typed])), { chainId: 11155111, source: 'request' })
})

test('chainOf: a disagreement is not resolved', () => {
  const result = chainOf(request('eth_sendTransaction', [{ to: A, chainId: '0x89' }], 1))
  assert.equal(result.chainId, null)
  assert.match(result.chainId === null ? result.reason : '', /names chain 137.*wallet reported chain 1/)
})

test('chainOf: no chain', () => {
  const result = chainOf(request('personal_sign', ['0x68656c6c6f', A]))
  assert.deepEqual(result, { chainId: null, reason: 'the request names no chain' })
  assert.equal(chainOf(request('eth_sendTransaction', [{ to: A, chainId: 'nonsense' }])).chainId, null)
})

test('parseQuantity takes hex strings only', () => {
  assert.equal(parseQuantity('0x1a'), 26)
  assert.equal(parseQuantity('0x0'), 0)
  for (const value of ['', '0x', '26', 26, '0xzz', ' 0x1', null, '0x20000000000000']) {
    assert.equal(parseQuantity(value), null, String(value))
  }
})
