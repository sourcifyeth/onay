import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Interface } from 'ethers'
import type { Hex } from '../src/messages.ts'
import { customSelector, errorFromAbi, errorsFromSignatures, parseLookup, signatureCache } from '../src/gates/errors.ts'

const abi = ['error TransactionDeadlinePassed()', 'error V3TooLittleReceived(uint256 amountOut)']
const errors = new Interface(abi)
const deadline = errors.encodeErrorResult('TransactionDeadlinePassed', []) as Hex
const tooLittle = errors.encodeErrorResult('V3TooLittleReceived', [42n]) as Hex

test('customSelector: the selector of a custom error, not of Error, Panic or an empty revert', () => {
  assert.equal(customSelector(deadline), '0x5bf6f916')
  assert.equal(customSelector('0x5BF6F916'), '0x5bf6f916')
  assert.equal(customSelector(`0x08c379a0${'00'.repeat(32)}`), null)
  assert.equal(customSelector(`0x4e487b71${'00'.repeat(32)}`), null)
  assert.equal(customSelector('0x'), null)
  assert.equal(customSelector('0x1234'), null)
  assert.equal(customSelector(null), null)
})

test('errorFromAbi: the error with its arguments, null if the ABI does not have it', () => {
  assert.equal(errorFromAbi(abi, deadline), 'TransactionDeadlinePassed()')
  assert.equal(errorFromAbi(abi, tooLittle), 'V3TooLittleReceived(amountOut: 42)')
  assert.equal(errorFromAbi(abi, '0x12345678'), null)
  assert.equal(errorFromAbi([], deadline), null)
  // The selector matches, but the data is too short for the arguments.
  assert.equal(errorFromAbi(abi, tooLittle.slice(0, 20) as Hex), null)
  // A broken ABI is no error.
  assert.equal(errorFromAbi(['not an abi'], deadline), null)
})

test('errorsFromSignatures: only the signatures that decode the data, each once', () => {
  assert.deepEqual(errorsFromSignatures(['TransactionDeadlinePassed()'], deadline), ['TransactionDeadlinePassed()'])
  assert.deepEqual(errorsFromSignatures(['V3TooLittleReceived(uint256)', 'V3TooLittleReceived(uint256)'], tooLittle), [
    'V3TooLittleReceived(42)',
  ])
  // Another selector, a signature that does not parse, and data too short
  // for the arguments.
  assert.deepEqual(errorsFromSignatures(['Other()', 'not a signature'], deadline), [])
  assert.deepEqual(errorsFromSignatures(['V3TooLittleReceived(uint256)'], tooLittle.slice(0, 20) as Hex), [])
})

test('parseLookup: verified signatures first, filtered ones out, a bad body is no answer', () => {
  const body = {
    ok: true,
    result: {
      function: {
        '0x5bf6f916': [
          { name: 'spam_1234()', filtered: true, hasVerifiedContract: false },
          { name: 'Other()', filtered: false, hasVerifiedContract: false },
          { name: 'TransactionDeadlinePassed()', filtered: false, hasVerifiedContract: true },
          { name: 42 },
        ],
      },
      event: {},
    },
  }
  assert.deepEqual(parseLookup(body, '0x5bf6f916'), ['TransactionDeadlinePassed()', 'Other()'])
  assert.deepEqual(parseLookup(body, '0x12345678'), [])
  assert.deepEqual(parseLookup({ ok: true, result: { function: { '0x12345678': null } } }, '0x12345678'), [])
  assert.deepEqual(parseLookup(null, '0x5bf6f916'), [])
  assert.deepEqual(parseLookup('text', '0x5bf6f916'), [])
})

test('signatureCache: one request per selector, and a failed lookup runs again', async () => {
  const urls: string[] = []
  let status = 500
  const cached = signatureCache(async (url) => {
    urls.push(url)
    const body = { ok: true, result: { function: { '0x5bf6f916': [{ name: 'TransactionDeadlinePassed()' }] } } }
    return new Response(JSON.stringify(body), { status })
  })
  await assert.rejects(cached('0x5bf6f916'), /4byte.sourcify.dev answered 500/)
  status = 200
  assert.deepEqual(await cached('0x5BF6F916'), ['TransactionDeadlinePassed()'])
  assert.deepEqual(await cached('0x5bf6f916'), ['TransactionDeadlinePassed()'])
  assert.deepEqual(urls, [
    'https://api.4byte.sourcify.dev/signature-database/v1/lookup?function=0x5bf6f916',
    'https://api.4byte.sourcify.dev/signature-database/v1/lookup?function=0x5bf6f916',
  ])
})
