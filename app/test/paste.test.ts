import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Transaction, Wallet } from 'ethers'
import { readPaste } from '../src/paste.ts'

const ACCOUNT = '0x2222222222222222222222222222222222222222'
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

// A transaction on Base, signed by a known key.
const wallet = new Wallet('0x' + '11'.repeat(32))
const signed = () =>
  wallet.signTransaction({
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
const SIGNED_PARAMS = [
  { from: wallet.address, to: USDC_OP, data: '0x', value: '0x5', gas: '0x5208', chainId: '0x2105' },
]

test('a signed raw transaction: the sender comes from the signature', async () => {
  assert.deepEqual(readPaste(` ${await signed()}\n`), {
    method: 'eth_sendTransaction',
    params: SIGNED_PARAMS,
    signed: true,
  })
})

test('a raw transaction broken into lines reads as one', async () => {
  const lines = (await signed()).match(/.{1,64}/g)!.join('\n')
  assert.deepEqual(readPaste(lines).params, SIGNED_PARAMS)
})

test('eth_sendRawTransaction is a raw transaction in a JSON-RPC request', async () => {
  const request = { jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: [await signed()] }
  assert.deepEqual(readPaste(JSON.stringify(request)), {
    method: 'eth_sendTransaction',
    params: SIGNED_PARAMS,
    signed: true,
  })
  assert.throws(
    () => readPaste(JSON.stringify({ method: 'eth_sendRawTransaction', params: [1] })),
    /takes a raw transaction in hex/,
  )
})

test('an unsigned raw transaction has no sender, and a creation has no recipient', () => {
  const raw = Transaction.from({ type: 2, chainId: 1, gasLimit: 100000n, data: '0x6080' }).unsignedSerialized
  assert.deepEqual(readPaste(raw), {
    method: 'eth_sendTransaction',
    params: [{ data: '0x6080', value: '0x0', gas: '0x186a0', chainId: '0x1' }],
    signed: false,
  })
})

test('a legacy raw transaction without EIP-155 names no chain, so it is refused', () => {
  const raw = Transaction.from({ type: 0, gasLimit: 21000n, to: USDC_OP, data: TRANSFER }).unsignedSerialized
  assert.throws(() => readPaste(raw), /names no chainId/)
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
  assert.deepEqual(readPaste(JSON.stringify(tx)), { method: 'eth_sendTransaction', params: [tx], signed: false })
  assert.throws(() => readPaste(JSON.stringify({ ...tx, chainId: undefined })), /names no chainId/)
  assert.throws(() => readPaste('{"chainId": 1, "value": "0x1"}'), /not a transaction or a JSON-RPC request/)
})

test('a transaction in a JSON-RPC request must name its chain too', () => {
  const tx = { from: ACCOUNT, to: USDC_OP, data: TRANSFER }
  for (const method of ['eth_sendTransaction', 'eth_signTransaction']) {
    assert.throws(() => readPaste(JSON.stringify({ method, params: [tx] })), /names no chainId/, method)
    assert.equal(readPaste(JSON.stringify({ method, params: [{ ...tx, chainId: '0xa' }] })).method, method)
  }
  const batch = { from: ACCOUNT, calls: [{ to: USDC_OP, data: TRANSFER }] }
  assert.throws(() => readPaste(JSON.stringify({ method: 'wallet_sendCalls', params: [batch] })), /names no chainId/)
  const named = { method: 'wallet_sendCalls', params: [{ ...batch, chainId: '0xa' }] }
  assert.equal(readPaste(JSON.stringify(named)).method, 'wallet_sendCalls')
})

test('a field that the review would refuse is refused in the card', () => {
  const tx = { chainId: 10, from: ACCOUNT, to: USDC_OP, data: TRANSFER, value: '1000000000000000000' }
  assert.throws(() => readPaste(JSON.stringify(tx)), /could not be read · the value of the transaction is not a hex/)
  const rpc = { method: 'eth_sendTransaction', params: [{ ...tx, value: '0x1', gas: 21000 }] }
  assert.throws(() => readPaste(JSON.stringify(rpc)), /could not be read · the gas limit/)
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
    signed: false,
  })
  assert.throws(() => readPaste(JSON.stringify({ method: 'eth_call', params: [] })), /eth_call is not a signing method/)
})

test('a JSON-RPC request whose params are not an array says so', () => {
  for (const request of [{ method: 'eth_sendTransaction', params: { to: USDC_OP } }, { method: 'personal_sign' }]) {
    assert.throws(() => readPaste(JSON.stringify(request)), /params of a JSON-RPC request must be an array/)
  }
})

test('text that is none of the forms is refused', () => {
  for (const text of ['', 'hello', '[1, 2]', 'null', '0x', '0xzz']) {
    assert.throws(() => readPaste(text), Error, text)
  }
})
