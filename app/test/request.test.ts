import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { SigningRequest } from '../src/messages.ts'
import { callsOf, chainOf, contractsOf, parseChainId, parseQuantity, requestProblem } from '../src/gates/request.ts'

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

const FROM = '0x9f21b45c7e83a10fd4e2c11098d2ce6f4b76c04e'

test('requestProblem: a field that is there but does not read', () => {
  const tx = (change: Record<string, unknown>) => request('eth_sendTransaction', [{ from: A, to: B, ...change }])
  assert.equal(requestProblem(tx({})), null)
  assert.equal(requestProblem(tx({ data: '0x', value: '0x0', gas: '0x5208' })), null)
  assert.equal(requestProblem(tx({ to: undefined })), null)
  assert.equal(requestProblem(tx({ to: null, data: null, value: null })), null)
  assert.match(requestProblem(tx({ value: '1000000000000000000' }))!, /value .* not a hex quantity/)
  assert.match(requestProblem(tx({ value: '' }))!, /value/)
  assert.match(requestProblem(tx({ value: 1 }))!, /value/)
  assert.match(requestProblem(tx({ data: 'a9059cbb' }))!, /data .* not hex bytes/)
  assert.match(requestProblem(tx({ data: '0xabc' }))!, /data/)
  assert.match(requestProblem(tx({ data: '0XAB' }))!, /data/)
  assert.match(requestProblem(tx({ input: 'junk' }))!, /data/)
  assert.match(requestProblem(tx({ data: '0xab', input: 'junk' }))!, /data .* not hex bytes/)
  assert.equal(requestProblem(tx({ data: '0xAB', input: '0xab' })), null)
  assert.equal(requestProblem(tx({ input: '0xab' })), null)
  assert.match(requestProblem(tx({ data: '0xab', input: '0xcd' }))!, /both data and input, and they differ/)
  const both = request('wallet_sendCalls', [{ from: A, calls: [{ to: B, data: '0x01', input: '0x02' }] }])
  assert.match(requestProblem(both)!, /call 1 has both data and input/)
  assert.match(requestProblem(tx({ to: B.slice(2) }))!, /recipient .* not an address/)
  assert.match(requestProblem(tx({ from: 'me' }))!, /sender/)
  assert.match(requestProblem(tx({ gas: '21000' }))!, /gas limit/)
  assert.match(requestProblem(request('eth_sendTransaction', ['junk']))!, /not an object/)
  const batch = (calls: unknown[]) => request('wallet_sendCalls', [{ from: A, calls }])
  assert.equal(requestProblem(batch([{ to: B, data: '0x' }])), null)
  assert.match(requestProblem(batch([{ to: B }, { to: B, value: '5' }]))!, /value of call 2/)
  assert.match(requestProblem(request('wallet_sendCalls', [{ from: 'x', calls: [] }]))!, /sender of the batch/)
  assert.equal(requestProblem(request('eth_signTypedData_v4', [A, '{}'])), null)
  assert.equal(requestProblem(request('personal_sign', ['0x1234', A])), null)
})

test('callsOf: a transaction, with its data, value and gas', () => {
  const tx = { from: FROM.toUpperCase().replace('0X', '0x'), to: A, data: '0x12345678', value: '0x5', gas: '0x5208' }
  assert.deepEqual(callsOf(request('eth_sendTransaction', [tx])), {
    calls: [{ from: FROM, to: A, data: '0x12345678', value: 5n, gas: 21000n }],
  })
  assert.deepEqual(callsOf(request('eth_signTransaction', [{ from: FROM, to: A, input: '0xab' }])), {
    calls: [{ from: FROM, to: A, data: '0xab', value: 0n, gas: null }],
  })
  assert.deepEqual(callsOf(request('eth_sendTransaction', [{ from: FROM, to: A, value: null, gas: null }])).calls, [
    { from: FROM, to: A, data: '0x', value: 0n, gas: null },
  ])
})

test('callsOf: each call of a batch, from the sender of the batch', () => {
  const batch = {
    from: FROM,
    calls: [
      { to: A, data: '0x01' },
      { to: B, value: '0x1' },
    ],
  }
  assert.deepEqual(callsOf(request('wallet_sendCalls', [batch])), {
    calls: [
      { from: FROM, to: A, data: '0x01', value: 0n, gas: null },
      { from: FROM, to: B, data: '0x', value: 1n, gas: null },
    ],
  })
})

test('callsOf: nothing to run, with the reason, and whether the request still runs on chain', () => {
  const reason = (method: string, params: unknown) => callsOf(request(method, params)).reason
  const runs = (method: string, params: unknown) => callsOf(request(method, params)).runs
  assert.match(reason('personal_sign', ['0x68656c6c6f', A]) ?? '', /nothing runs/)
  assert.match(reason('eth_signTypedData_v4', [A, '{}']) ?? '', /nothing runs/)
  assert.equal(runs('personal_sign', ['0x68656c6c6f', A]), false)
  assert.equal(runs('eth_signTypedData_v4', [A, '{}']), false)
  assert.equal(runs('eth_sendTransaction', [{ to: A }]), true)
  assert.equal(runs('eth_sendTransaction', [{ from: FROM }]), true)
  assert.equal(runs('wallet_sendCalls', [{ calls: [{ to: A }] }]), true)
  assert.equal(reason('eth_sendTransaction', [{ to: A }]), 'the request names no sender')
  assert.equal(reason('eth_sendTransaction', [{ from: FROM }]), 'contract creation · not simulated')
  assert.equal(reason('eth_sendTransaction', [{ from: FROM, to: A, data: '0x123' }]), 'the request has unexpected data')
  assert.equal(
    reason('eth_sendTransaction', [{ from: FROM, to: A, value: '5' }]),
    'the request has an unexpected value',
  )
  assert.equal(
    reason('eth_sendTransaction', [{ from: FROM, to: A, gas: 21000 }]),
    'the request has an unexpected gas limit',
  )
  assert.equal(
    reason('wallet_sendCalls', [{ from: FROM, calls: [{ to: A }, {}] }]),
    'contract creation · not simulated',
  )
  assert.equal(reason('eth_sendTransaction', 'nonsense'), 'the request names no sender')
})
