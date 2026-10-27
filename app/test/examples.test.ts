import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EXAMPLES } from '../src/examples.ts'
import { readPaste } from '../src/paste.ts'
import { chainNamedIn } from '../src/gates/request.ts'

const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

test('every example reads as a request on mainnet, from vitalik.eth', () => {
  assert.equal(EXAMPLES.length, 5)
  for (const example of EXAMPLES) {
    const request = readPaste(example.text)
    assert.equal(request.signed, false, example.label)
    assert.equal(chainNamedIn(request), 1, example.label)
    const params = request.params as unknown[]
    const account = request.method === 'eth_signTypedData_v4' ? params[0] : (params[0] as { from: string }).from
    assert.equal(account, VITALIK, example.label)
  }
})

test('the examples cover transactions and typed data', () => {
  const methods = EXAMPLES.map((example) => readPaste(example.text).method)
  assert.deepEqual(methods, [
    'eth_sendTransaction',
    'eth_sendTransaction',
    'eth_signTypedData_v4',
    'eth_sendTransaction',
    'eth_sendTransaction',
  ])
})
