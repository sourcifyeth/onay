import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { SigningRequest } from '../src/messages.ts'
import { fieldsOf } from '../src/compare/fields.ts'

const YOU = '0x9f21b45c7e83a10fd4e2c11098d2ce6f4b76c04e'
const YOU_CHECKSUM = '0x9f21b45C7e83a10Fd4E2C11098D2Ce6F4B76c04e'
const ALICE = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
const ALICE_CHECKSUM = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
// The ERC-8213 test case: transfer(0x4675…a263, 1e18).
const TRANSFER =
  '0xa9059cbb0000000000000000000000004675c7e5baafbffbca748158becba61ef3b0a2630000000000000000000000000000000000000000000000000de0b6b3a7640000'
const TRANSFER_DIGEST = '0x812cee5d9cc7461c04bbcd7b70af9c28b243ac5d74d3453b008b93b7dac69985'

function request(method: string, params: unknown): SigningRequest {
  return {
    connection: 1,
    id: '1',
    source: 'browser',
    origin: 'https://dapp.example',
    method,
    params,
    chainId: 1,
    receivedAt: 0,
    outcome: null,
    signed: false,
  }
}

test('a transaction: full addresses with the checksum, the length, selector, and Calldata Digest', () => {
  const fields = fieldsOf(request('eth_sendTransaction', [{ from: YOU, to: ALICE, data: TRANSFER, value: '0x10' }]))
  assert.deepEqual(fields, {
    kind: 'transaction',
    from: YOU_CHECKSUM,
    call: {
      to: ALICE_CHECKSUM,
      value: 16n,
      data: TRANSFER,
      length: 68,
      selector: '0xa9059cbb',
      digest: TRANSFER_DIGEST,
    },
    delegations: [],
  })
})

test('a transfer without calldata has no digest, and a creation has no recipient', () => {
  const plain = fieldsOf(request('eth_sendTransaction', [{ from: YOU, to: ALICE, value: '0x1' }]))
  assert.equal(plain.kind === 'transaction' && plain.call.digest, null)
  assert.equal(plain.kind === 'transaction' && plain.call.length, 0)
  const short = fieldsOf(request('eth_signTransaction', [{ from: YOU, to: ALICE, data: '0x01' }]))
  assert.equal(short.kind === 'transaction' && short.call.selector, null)
  const creation = fieldsOf(request('eth_sendTransaction', [{ from: YOU, data: '0x6080' }]))
  assert.equal(creation.kind === 'transaction' && creation.call.to, null)
})

test('EIP-7702 delegations show with the checksum', () => {
  const authorizationList = [{ address: ALICE, chainId: '0x0', nonce: '0x2' }]
  const fields = fieldsOf(request('eth_sendTransaction', [{ from: YOU, to: YOU, authorizationList }]))
  assert.deepEqual(fields.kind === 'transaction' && fields.delegations, [
    { address: ALICE_CHECKSUM, chainId: 0n, nonce: 2n },
  ])
})

test('a batch: one block for each call', () => {
  const calls = [
    { to: ALICE, data: TRANSFER },
    { to: YOU, value: '0x5' },
  ]
  const fields = fieldsOf(request('wallet_sendCalls', [{ from: YOU, chainId: '0x1', calls }]))
  assert.equal(fields.kind, 'batch')
  if (fields.kind !== 'batch') return
  assert.equal(fields.from, YOU_CHECKSUM)
  assert.deepEqual(
    fields.calls.map((call) => [call.to, call.digest, call.value]),
    [
      [ALICE_CHECKSUM, TRANSFER_DIGEST, 0n],
      [YOU_CHECKSUM, null, 5n],
    ],
  )
})

const MAIL = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' },
    ],
    Mail: [
      { name: 'from', type: 'Person' },
      { name: 'to', type: 'Person' },
      { name: 'contents', type: 'string' },
    ],
  },
  primaryType: 'Mail',
  domain: {
    name: 'Ether Mail',
    version: '1',
    chainId: 1,
    verifyingContract: '0xcccccccccccccccccccccccccccccccccccccccc',
  },
  message: {
    from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
    to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
    contents: 'Hello, Bob!',
  },
}

test('typed data: the readable domain and the three digests', () => {
  const fields = fieldsOf(request('eth_signTypedData_v4', [YOU, JSON.stringify(MAIL)]))
  assert.deepEqual(fields, {
    kind: 'typedData',
    signer: YOU_CHECKSUM,
    domain: {
      name: 'Ether Mail',
      version: '1',
      verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
      hasChain: true,
      chainId: 1,
    },
    primaryType: 'Mail',
    digests: {
      digest: '0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2',
      domainHash: '0xf2cee375fa42b42143804025fc449deafd50cc031ca257e0b194a650a912090f',
      messageHash: '0xc52c0ee5d84264471806290a3f2c4cecfc5490626bf912d01f240d7a274b371e',
    },
    reason: null,
  })
})

test('typed data without a chain, or that does not hash one way, says so', () => {
  const { chainId: _, ...domain } = MAIL.domain
  const noChain = { ...MAIL, domain, types: { ...MAIL.types, EIP712Domain: MAIL.types.EIP712Domain.slice(0, 2) } }
  const fields = fieldsOf(request('eth_signTypedData_v4', [YOU, noChain]))
  assert.equal(fields.kind === 'typedData' && fields.domain.hasChain, false)
  assert.equal(fields.kind === 'typedData' && fields.domain.chainId, null)
  assert.ok(fields.kind === 'typedData' && fields.digests)
  const loose = { ...MAIL, message: { ...MAIL.message, contents: 5 } }
  const unread = fieldsOf(request('eth_signTypedData_v4', [YOU, loose]))
  assert.equal(unread.kind === 'typedData' && unread.reason, 'message.contents is not a string')
  assert.equal(unread.kind === 'typedData' && unread.digests, null)
})

test('typed data whose EIP712Domain type lists a chainId without a value: the chain is unknown, not absent', () => {
  const { chainId: _, ...domain } = MAIL.domain
  const fields = fieldsOf(request('eth_signTypedData_v4', [YOU, { ...MAIL, domain }]))
  if (fields.kind !== 'typedData') return assert.fail(fields.kind)
  assert.equal(fields.domain.hasChain, true)
  assert.equal(fields.domain.chainId, null)
  assert.equal(fields.reason, 'domain.chainId has no value')
})

test('typed data: a domain field that the EIP712Domain type does not list is not signed, so it does not show', () => {
  const nameOnly = { ...MAIL, types: { ...MAIL.types, EIP712Domain: MAIL.types.EIP712Domain.slice(0, 2) } }
  const extra = fieldsOf(request('eth_signTypedData_v4', [YOU, nameOnly]))
  if (extra.kind !== 'typedData') return assert.fail(extra.kind)
  assert.deepEqual(extra.domain, {
    name: 'Ether Mail',
    version: '1',
    verifyingContract: null,
    hasChain: false,
    chainId: null,
  })
  const { chainId: _, verifyingContract: __, ...signed } = MAIL.domain
  const exact = fieldsOf(request('eth_signTypedData_v4', [YOU, { ...nameOnly, domain: signed }]))
  assert.ok(extra.digests)
  assert.deepEqual(extra.digests, exact.kind === 'typedData' && exact.digests)
})

test('a message: the text, the hidden characters, and the ERC-191 Digest', () => {
  const hello = fieldsOf(request('personal_sign', ['0x68656c6c6f', YOU]))
  assert.equal(hello.kind, 'message')
  if (hello.kind !== 'message') return
  assert.equal(hello.text, 'hello')
  assert.equal(hello.signer, YOU_CHECKSUM)
  assert.equal(hello.digest, '0x50b2c43fd39106bafbba0da34fc430e1f91e3c96ea2acee2bc34119f92b37750')
  assert.equal(hello.hidden, false)
  assert.equal(hello.nonAscii, false)
  const text = (message: string) => fieldsOf(request('personal_sign', [message, YOU]))
  const lines = text('Sign in\nto example.com')
  assert.equal(lines.kind === 'message' && lines.hidden, false)
  const tabs = text('a\tb\r\nc')
  assert.equal(tabs.kind === 'message' && tabs.hidden, false)
  const bell = text('a\u0007b')
  assert.equal(bell.kind === 'message' && bell.hidden, true)
  const bidi = text('pay \u202eevil')
  assert.equal(bidi.kind === 'message' && bidi.hidden, true)
  const zeroWidth = text('a\u200bb')
  assert.equal(zeroWidth.kind === 'message' && zeroWidth.hidden, true)
  const cyrillic = text('p\u0430ypal')
  assert.equal(cyrillic.kind === 'message' && cyrillic.nonAscii, true)
  assert.equal(cyrillic.kind === 'message' && cyrillic.hidden, false)
  // A Hangul filler, a no-break space, a blank braille pattern, and a line separator.
  for (const blank of ['\u3164', '\u00a0', '\u2800', '\u2028']) {
    const message = text(`a${blank}b`)
    assert.equal(message.kind === 'message' && message.hidden, true, blank.codePointAt(0)?.toString(16))
  }
  const binary = fieldsOf(request('eth_sign', [YOU, '0xff00']))
  assert.equal(binary.kind === 'message' && binary.text, null)
})

test('eth_sign: the message without a digest, because wallets sign it in different ways', () => {
  const fields = fieldsOf(request('eth_sign', [YOU, '0x68656c6c6f']))
  if (fields.kind !== 'message') return assert.fail(fields.kind)
  assert.equal(fields.text, 'hello')
  assert.equal(fields.signer, YOU_CHECKSUM)
  assert.equal(fields.digest, null)
  assert.match(fields.reason ?? '', /eth_sign in different ways/)
  const signed = fieldsOf(request('personal_sign', ['0x68656c6c6f', YOU]))
  assert.equal(signed.kind === 'message' && signed.reason, null)
})

test('nothing to compare: a request that does not read, and legacy typed data', () => {
  assert.deepEqual(fieldsOf(request('personal_sign', ['0xabc', YOU])), {
    kind: 'none',
    reason: 'the request could not be read · the message is not hex bytes with the 0x prefix',
  })
  assert.deepEqual(fieldsOf(request('eth_sendTransaction', [{ to: ALICE, value: '1' }])), {
    kind: 'none',
    reason: 'the request could not be read · the value of the transaction is not a hex quantity with the 0x prefix',
  })
  assert.match((fieldsOf(request('eth_signTypedData', [[], YOU])) as { reason: string }).reason, /old format/)
})
