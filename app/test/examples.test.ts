import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EXAMPLES } from '../src/examples.ts'
import { readPaste } from '../src/paste.ts'
import { chainNamedIn, messageOf } from '../src/gates/request.ts'

const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

// A message names no chain, so only the other requests name mainnet.
test('every example reads as a request from vitalik.eth, on mainnet if it names a chain', () => {
  assert.equal(EXAMPLES.length, 6)
  for (const example of EXAMPLES) {
    const request = readPaste(example.text)
    assert.equal(request.signed, false, example.label)
    const params = request.params as unknown[]
    const message = messageOf(request)
    if (message) {
      assert.equal(message.problem, undefined, example.label)
      assert.equal(message.signer, VITALIK.toLowerCase(), example.label)
      assert.equal(chainNamedIn(request), null, example.label)
      continue
    }
    assert.equal(chainNamedIn(request), 1, example.label)
    const account = request.method === 'eth_signTypedData_v4' ? params[0] : (params[0] as { from: string }).from
    assert.equal(account, VITALIK, example.label)
  }
})

test('the examples cover transactions, typed data, and a message', () => {
  const methods = EXAMPLES.map((example) => readPaste(example.text).method)
  assert.deepEqual(methods, [
    'eth_sendTransaction',
    'eth_sendTransaction',
    'eth_signTypedData_v4',
    'eth_sendTransaction',
    'eth_sendTransaction',
    'personal_sign',
  ])
})

test('the Sign-In with Ethereum example is UTF-8 text in the shape of EIP-4361', () => {
  const example = EXAMPLES.find((entry) => readPaste(entry.text).method === 'personal_sign')!
  const message = messageOf(readPaste(example.text))
  if (!message || message.problem !== undefined) return assert.fail(message?.problem ?? 'not a message')
  const lines = new TextDecoder().decode(message.bytes).split('\n')
  assert.equal(lines[0], 'example.com wants you to sign in with your Ethereum account:')
  assert.equal(lines[1], VITALIK)
  assert.ok(lines.includes('Chain ID: 1'))
})
