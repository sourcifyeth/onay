// The vectors come from sources other than ethers: the test cases of
// ERC-8213, the example of EIP-712, and the snapshots of MetaMask's
// eth-sig-util, which signs typed data in MetaMask.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { TypedData } from '@ethereum-sourcify/clear-signing'
import { calldataDigest, erc191Digest, typedDataDigests } from '../src/compare/digest.ts'

test('Calldata Digest: the ERC-8213 test case', () => {
  const data =
    '0xa9059cbb0000000000000000000000004675c7e5baafbffbca748158becba61ef3b0a2630000000000000000000000000000000000000000000000000de0b6b3a7640000'
  assert.equal(calldataDigest(data), '0x812cee5d9cc7461c04bbcd7b70af9c28b243ac5d74d3453b008b93b7dac69985')
})

test('ERC-191 Digest: the ERC-8213 test cases, with the length in bytes', () => {
  const text = (message: string) => erc191Digest(new TextEncoder().encode(message))
  assert.equal(text('hello'), '0x50b2c43fd39106bafbba0da34fc430e1f91e3c96ea2acee2bc34119f92b37750')
  assert.equal(text('héllo'), '0x42fd95dd8ed22d7d934d6ffff71ed0b730835b0de4bb3532a271568c8760c8d2')
})

const DOMAIN_TYPE = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
]

// The example of EIP-712, assets/eip-712/Example.js.
const MAIL: TypedData = {
  account: '0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826',
  types: {
    EIP712Domain: DOMAIN_TYPE,
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
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  },
  message: {
    from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
    to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
    contents: 'Hello, Bob!',
  },
}

test('EIP-712 Digest, Domain Hash, Message Hash: the example of EIP-712, in v3 and v4', () => {
  for (const version of ['v3', 'v4'] as const) {
    assert.deepEqual(typedDataDigests(MAIL, version).digests, {
      digest: '0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2',
      domainHash: '0xf2cee375fa42b42143804025fc449deafd50cc031ca257e0b194a650a912090f',
      messageHash: '0xc52c0ee5d84264471806290a3f2c4cecfc5490626bf912d01f240d7a274b371e',
    })
  }
})

// "hashStruct V4 should hash data with a custom data type array" in
// eth-sig-util. Its second address has a wrong checksum, which MetaMask
// takes. The unused Group type is here so that ethers must leave it out.
const ARRAYS: TypedData = {
  ...MAIL,
  types: {
    EIP712Domain: DOMAIN_TYPE,
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address[]' },
    ],
    Mail: [
      { name: 'from', type: 'Person' },
      { name: 'to', type: 'Person[]' },
      { name: 'contents', type: 'string' },
    ],
    Group: [
      { name: 'name', type: 'string' },
      { name: 'members', type: 'Person[]' },
    ],
  },
  message: {
    from: {
      name: 'Cow',
      wallet: ['0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826', '0xDD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826'],
    },
    to: [{ name: 'Bob', wallet: ['0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'] }],
    contents: 'Hello, Bob!',
  },
}

test('Message Hash: arrays, an unused type, and an address with a wrong checksum, as MetaMask hashes them', () => {
  const { digests } = typedDataDigests(ARRAYS, 'v4')
  assert.equal(digests?.messageHash, '0xac26cc7aa2cb9a8a445fae4e48b33f978b558da9b16e26381c53814d3317f541')
  assert.equal(digests?.domainHash, '0xf2cee375fa42b42143804025fc449deafd50cc031ca257e0b194a650a912090f')
})

test('eth_signTypedData_v3 does not encode arrays', () => {
  assert.deepEqual(typedDataDigests(ARRAYS, 'v3'), {
    digests: null,
    reason: 'message.from.wallet is an array, and only eth_signTypedData_v4 encodes arrays',
  })
})

function reasonFor(change: (typed: TypedData) => void): string | undefined {
  const typed = structuredClone(MAIL)
  change(typed)
  const result = typedDataDigests(typed, 'v4')
  assert.equal(result.digests, null)
  return result.reason
}

test('typed data that wallets hash in different ways has no digest', () => {
  assert.match(reasonFor((t) => delete t.types.EIP712Domain) ?? '', /no EIP712Domain type/)
  assert.equal(
    reasonFor((t) => (t.primaryType = 'Letter')),
    'the typed data has no type for its primary type Letter',
  )
  assert.equal(
    reasonFor((t) => (t.primaryType = 'EIP712Domain')),
    'the typed data has no type for its primary type EIP712Domain',
  )
  assert.equal(
    reasonFor((t) => delete (t.message.to as Record<string, unknown>).wallet),
    'message.to.wallet has no value',
  )
  assert.equal(
    reasonFor((t) => ((t.message.to as Record<string, unknown>).wallet = null)),
    'message.to.wallet has no value',
  )
  assert.equal(
    reasonFor((t) => (t.message.to = 'Bob')),
    'message.to is not an object',
  )
  // A missing field named __proto__ is missing, not Object.prototype.
  assert.equal(
    reasonFor((t) => {
      t.types = { EIP712Domain: DOMAIN_TYPE, Empty: [], Root: [{ name: '__proto__', type: 'Empty' }] }
      t.primaryType = 'Root'
      t.message = {}
    }),
    'message.__proto__ has no value',
  )
  assert.equal(
    reasonFor((t) => (t.domain.chainId = 1.5)),
    'domain.chainId is not an integer',
  )
  assert.equal(
    reasonFor((t) => (t.domain.chainId = '1e3')),
    'domain.chainId is not an integer',
  )
  assert.equal(
    reasonFor((t) => (t.domain.verifyingContract = '0xcccc')),
    'domain.verifyingContract is not an address',
  )
  assert.equal(
    reasonFor((t) => t.types.Person.push({ name: 'age', type: 'uint' })),
    'Person.age has the type uint, which EIP-712 does not define',
  )
  assert.equal(
    reasonFor((t) => t.types.Person.push({ name: 'id', type: 'bytes33' })),
    'Person.id has the type bytes33, which EIP-712 does not define',
  )
})

test('a value of the wrong form has no digest', () => {
  const typed = (type: string, value: unknown): TypedData => ({
    ...MAIL,
    types: { EIP712Domain: DOMAIN_TYPE, Item: [{ name: 'value', type }] },
    primaryType: 'Item',
    message: { value },
  })
  const reason = (type: string, value: unknown) => typedDataDigests(typed(type, value), 'v4').reason
  assert.equal(reason('bool', 'true'), 'message.value is not true or false')
  assert.equal(reason('string', 7), 'message.value is not a string')
  assert.equal(reason('bytes', 'abcd'), 'message.value is not hex bytes with the 0x prefix')
  assert.equal(reason('bytes', '0xabc'), 'message.value is not hex bytes with the 0x prefix')
  assert.equal(reason('uint256[2]', ['1']), 'message.value has 1 items, its type uint256[2] has 2')
  // ethers checks the range and the length of fixed bytes.
  assert.ok(reason('uint8', 256))
  assert.ok(reason('uint256', '-1'))
  assert.ok(reason('bytes2', '0xabcdef'))
  for (const [type, value] of [
    ['bool', false],
    ['string', ''],
    ['bytes', '0x'],
    ['bytes2', '0xabcd'],
    ['uint8', 255],
    ['uint256', '0xff'],
    ['int8', '-128'],
    ['uint256[2]', ['1', 2]],
  ] as const) {
    assert.equal(reason(type, value), undefined, type)
  }
})
