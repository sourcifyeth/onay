import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Transaction, Wallet } from 'ethers'
import { readPaste } from '../src/paste.ts'

const ACCOUNT = '0x6135bd8b8ec1e6f9a62b2bfcb5a0e66cba5418f8'
const USDC_OP = '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'
const TRANSFER =
  '0xa9059cbb0000000000000000000000001111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000000000000a'
const TYPED = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Mail: [{ name: 'contents', type: 'string' }],
  },
  primaryType: 'Mail',
  domain: { name: 'Mail', chainId: 1, verifyingContract: '0xcccccccccccccccccccccccccccccccccccccccc' },
  message: { contents: 'Hello' },
}

test('a signed raw transaction: the sender comes from the signature', async () => {
  const wallet = new Wallet('0x' + '11'.repeat(32))
  const raw = await wallet.signTransaction({
    type: 2,
    chainId: 8453,
    nonce: 0,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    gasLimit: 21000n,
    to: USDC_OP,
    value: 5n,
    data: '0x',
  })
  assert.deepEqual(readPaste(` ${raw}\n`), {
    method: 'eth_sendTransaction',
    params: [{ from: wallet.address, to: USDC_OP, data: '0x', value: '0x5', gas: '0x5208', chainId: '0x2105' }],
  })
})

test('an unsigned raw transaction has no sender, and a creation has no recipient', () => {
  const raw = Transaction.from({ type: 2, chainId: 1, gasLimit: 100000n, data: '0x6080' }).unsignedSerialized
  assert.deepEqual(readPaste(raw).params, [{ data: '0x6080', value: '0x0', gas: '0x186a0', chainId: '0x1' }])
})

test('a legacy raw transaction without EIP-155 names no chain', () => {
  const raw = Transaction.from({ type: 0, gasLimit: 21000n, to: USDC_OP, data: TRANSFER }).unsignedSerialized
  assert.deepEqual(readPaste(raw).params, [{ to: USDC_OP, data: TRANSFER, value: '0x0', gas: '0x5208' }])
})

test('blob and EIP-7702 transactions are refused', () => {
  const blob = Transaction.from({
    type: 3,
    chainId: 1,
    to: USDC_OP,
    maxFeePerBlobGas: 1n,
    blobVersionedHashes: ['0x01' + '00'.repeat(31)],
  }).unsignedSerialized
  assert.throws(() => readPaste(blob), /type 3 is not supported/)
  const setCode = Transaction.from({ type: 4, chainId: 1, to: USDC_OP, authorizationList: [] }).unsignedSerialized
  assert.throws(() => readPaste(setCode), /type 4 is not supported/)
})

test('hex that is not a transaction, such as calldata alone, is refused', () => {
  assert.throws(() => readPaste(TRANSFER), /not a raw transaction · paste calldata as JSON/)
})

test('a transaction as JSON must name its chain', () => {
  const tx = { chainId: 10, from: ACCOUNT, to: USDC_OP, data: TRANSFER }
  assert.deepEqual(readPaste(JSON.stringify(tx)), { method: 'eth_sendTransaction', params: [tx] })
  assert.throws(() => readPaste(JSON.stringify({ ...tx, chainId: undefined })), /names no chainId/)
  assert.throws(() => readPaste('{"chainId": 1, "value": "0x1"}'), /not a transaction or a JSON-RPC request/)
})

test('typed data without its signing account is refused, with the form that names it', () => {
  const noAccount = /names no signing account · paste it as \{"method": "eth_signTypedData_v4"/
  assert.throws(() => readPaste(JSON.stringify(TYPED)), noAccount)
  for (const account of [null, 'junk', '0x1234']) {
    const params = [account, TYPED]
    assert.throws(() => readPaste(JSON.stringify({ method: 'eth_signTypedData_v4', params })), noAccount)
    assert.throws(() => readPaste(JSON.stringify({ method: 'eth_signTypedData_v3', params })), noAccount)
  }
})

test('a JSON-RPC request keeps its method and params, for signing methods only', () => {
  const params = [ACCOUNT, TYPED]
  assert.deepEqual(readPaste(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_signTypedData_v4', params })), {
    method: 'eth_signTypedData_v4',
    params,
  })
  assert.throws(
    () => readPaste(JSON.stringify({ method: 'eth_sendRawTransaction', params: ['0x00'] })),
    /eth_sendRawTransaction is not a signing method/,
  )
})

test('text that is none of the forms is refused', () => {
  for (const text of ['', 'hello', '[1, 2]', 'null', '0x', '0xzz']) {
    assert.throws(() => readPaste(text), Error, text)
  }
})
