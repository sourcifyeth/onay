// The rendering with the real clear-signing library over an in-memory
// registry: a fake library would hide a difference in what it takes and
// gives.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Descriptor, DescriptorResolver, FormatOptions, RegistryIndex } from '@ethereum-sourcify/clear-signing'
import { Interface, id } from 'ethers'
import type { Hex, SigningRequest } from '../src/messages.ts'
import {
  asValue,
  formatAmount,
  inputOf,
  reasonOf,
  render,
  rendered,
  type RenderOptions,
} from '../src/clear-signing/render.ts'

const USDC: Hex = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const ALICE: Hex = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
const YOU: Hex = '0x9f21b45c7e83a10fd4e2c11098d2ce6f4b76c04e'
const OTHER: Hex = '0x2222222222222222222222222222222222222222'
const AUDITOR = '0x3846c3A30E62075Fa916216b35EF04B8F53931f6'

const ERC20 = ['function transfer(address to, uint256 value) returns (bool)']
const erc20 = new Interface(ERC20)
const ABI = JSON.parse(erc20.formatJson()) as unknown[]
const TRANSFER = erc20.encodeFunctionData('transfer', [ALICE, 1_500_000n]) as Hex

const usdcDescriptor: Descriptor = {
  context: { contract: { deployments: [{ chainId: 1, address: USDC }] } },
  metadata: { owner: 'Circle', contractName: 'USDC' },
  display: {
    formats: {
      'transfer(address to, uint256 value)': {
        intent: 'Send',
        interpolatedIntent: 'Send {value} to {to}',
        fields: [
          { path: 'value', label: 'Amount', format: 'tokenAmount', params: { tokenPath: '@.to' } },
          { path: 'to', label: 'To', format: 'addressName', params: { sources: ['ens'] } },
        ],
      },
    },
  },
}

const PERMIT_TYPE = 'Permit(address spender,uint256 value)'
const permitDescriptor: Descriptor = {
  context: { eip712: { deployments: [{ chainId: 1, address: USDC }] } },
  metadata: { owner: 'Circle' },
  display: {
    formats: {
      [PERMIT_TYPE]: {
        intent: 'Permit',
        fields: [
          { path: 'spender', label: 'Spender', format: 'raw' },
          { path: 'value', label: 'Value', format: 'raw' },
        ],
      },
    },
  },
}

const index: RegistryIndex = {
  calldataIndex: { [`eip155:1:${USDC}`]: 'registry/circle/calldata-usdc.json' },
  typedDataIndex: {
    [`eip155:1:${USDC}`]: {
      Permit: [{ path: 'registry/circle/eip712-usdc.json', encodeTypeHashes: [id(PERMIT_TYPE)] }],
    },
  },
}

// The registry in memory. No auditor attested anything.
const resolver: DescriptorResolver = {
  index,
  fetchDescriptor: async (path) => (path.includes('eip712') ? permitDescriptor : usdcDescriptor),
  fetchAttestation: async () => null,
}

const externalDataProvider = {
  resolveToken: async () => ({ name: 'USD Coin', symbol: 'USDC', decimals: 6 }),
  resolveEnsName: async () => ({ name: 'alice.eth', typeMatch: true }),
  chainClient: { call: async () => '0x' },
}

function options(change: Partial<RenderOptions> = {}, attesters?: string[]): RenderOptions {
  const format: FormatOptions = {
    descriptorResolverOptions: {
      type: 'custom',
      resolver,
      trustedTokens: change.trustedTokens,
      attestations: attesters && { trustedAttesters: attesters },
    },
    externalDataProvider,
  }
  return { chainId: 1, format, index, trustedTokens: {}, abis: (address) => (address === USDC ? ABI : null), ...change }
}

function request(method: string, params: unknown): SigningRequest {
  return {
    connection: 1,
    id: '1',
    origin: 'https://dapp.example',
    method,
    params,
    chainId: 1,
    receivedAt: 0,
    outcome: null,
  }
}

const typedData = {
  domain: { name: 'USDC', chainId: 1, verifyingContract: USDC },
  primaryType: 'Permit',
  types: {
    Permit: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
  },
  message: { spender: ALICE, value: '5' },
}

test('inputOf: a transaction, with its value as a quantity', () => {
  const tx = { from: YOU, to: USDC.toUpperCase().replace('0X', '0x'), data: TRANSFER, value: '0xde0b6b3a7640000' }
  assert.deepEqual(inputOf(request('eth_sendTransaction', [tx])), {
    kind: 'transaction',
    from: YOU,
    to: USDC,
    data: TRANSFER,
    value: 10n ** 18n,
  })
  const input = { from: YOU, to: ALICE, input: '0xAB' }
  assert.deepEqual(inputOf(request('eth_signTransaction', [input])), {
    kind: 'transaction',
    from: YOU,
    to: ALICE,
    data: '0xab',
    value: 0n,
  })
})

test('inputOf: a batch, typed data, and what it does not cover', () => {
  const batch = {
    from: YOU,
    chainId: '0x1',
    calls: [{ to: USDC, data: TRANSFER }, { to: ALICE, value: '0x1' }, 'junk'],
  }
  assert.deepEqual(inputOf(request('wallet_sendCalls', [batch])), {
    kind: 'batch',
    from: YOU,
    calls: [
      { to: USDC, data: TRANSFER, value: 0n },
      { to: ALICE, data: '0x', value: 1n },
      { to: null, data: '0x', value: 0n },
    ],
  })
  const typed = inputOf(request('eth_signTypedData_v4', [YOU, JSON.stringify(typedData)]))
  assert.deepEqual(typed, { kind: 'typedData', account: YOU, typed: { ...typedData, account: YOU } })
  assert.deepEqual(inputOf(request('eth_signTypedData_v4', [YOU, typedData])), typed)
  assert.equal(inputOf(request('personal_sign', ['0xab', YOU])).kind, 'none')
})

test('inputOf: params with the wrong shape give none, not a throw', () => {
  assert.equal(inputOf(request('eth_sendTransaction', 'junk')).kind, 'none')
  assert.equal(inputOf(request('eth_sendTransaction', [])).kind, 'none')
  assert.equal(inputOf(request('wallet_sendCalls', [{ calls: 'junk' }])).kind, 'none')
  assert.equal(inputOf(request('eth_signTypedData_v4', [YOU, '{not json'])).kind, 'none')
  assert.equal(
    inputOf(request('eth_signTypedData_v4', [YOU, { ...typedData, types: { Permit: 'junk' } }])).kind,
    'none',
  )
  assert.equal(inputOf(request('eth_signTypedData_v4', ['junk', typedData])).kind, 'none')
})

test('asValue reads hex and decimal quantities, and treats a missing value as zero', () => {
  assert.equal(asValue('0x10'), 16n)
  assert.equal(asValue('16'), 16n)
  assert.equal(asValue(16), 16n)
  assert.equal(asValue(undefined), 0n)
  assert.equal(asValue(''), 0n)
  assert.equal(asValue('0x'), null)
  assert.equal(asValue('1.5'), null)
  assert.equal(asValue(-1), null)
})

test('a transaction with a trusted descriptor renders with intent, fields, and the source', async () => {
  const input = inputOf(request('eth_sendTransaction', [{ from: YOU, to: USDC, data: TRANSFER }]))
  const result = await render(input, options())
  assert.equal(result.kind, 'transaction')
  if (result.kind !== 'transaction') return
  const { call } = result
  assert.equal(rendered(call.display), true)
  assert.equal(call.display?.interpolatedIntent, 'Send 1.5 USDC to alice.eth')
  assert.deepEqual(
    call.display?.fields?.map((field) => ('value' in field ? [field.label, field.value] : null)),
    [
      ['Amount', '1.5 USDC'],
      ['To', 'alice.eth'],
    ],
  )
  assert.deepEqual(call.source, { kind: 'registry', path: 'registry/circle/calldata-usdc.json' })
  assert.equal(call.decoded?.signature, 'transfer(address to, uint256 value)')
  assert.equal(reasonOf(call.display), null)
})

test('without a trusted attestation the descriptor is not used: raw fallback, and the ABI decoding', async () => {
  const input = inputOf(request('eth_sendTransaction', [{ to: USDC, data: TRANSFER }]))
  for (const attesters of [[], [AUDITOR]]) {
    const result = await render(input, options({}, attesters))
    if (result.kind !== 'transaction') return assert.fail(result.kind)
    const { call } = result
    assert.equal(rendered(call.display), false)
    assert.equal(call.source, null)
    assert.equal(reasonOf(call.display)?.code, 'NO_TRUSTED_ATTESTATION')
    assert.equal(call.display?.rawCalldataFallback?.selector, '0xa9059cbb')
    assert.equal(call.decoded?.params[1].value, '1500000')
  }
})

test('a contract without a descriptor: no descriptor, and the ABI decoding where there is one', async () => {
  const input = inputOf(request('eth_sendTransaction', [{ to: OTHER, data: TRANSFER }]))
  const result = await render(input, options())
  if (result.kind !== 'transaction') return assert.fail(result.kind)
  assert.equal(reasonOf(result.call.display)?.code, 'NO_DESCRIPTOR')
  assert.equal(result.call.decoded, null)
})

test('a token with the verified ABI of the standard renders with the bundled template', async () => {
  const input = inputOf(request('eth_sendTransaction', [{ to: OTHER, data: TRANSFER }]))
  const trustedTokens = { 1: { [OTHER]: 'erc20' as const } }
  const result = await render(input, options({ trustedTokens, abis: () => ABI }))
  if (result.kind !== 'transaction') return assert.fail(result.kind)
  assert.equal(result.call.display?.intent, 'Send')
  assert.deepEqual(result.call.source, { kind: 'template' })
  assert.equal(result.call.decoded?.name, 'transfer')
})

test('a plain value transfer has nothing to render', async () => {
  const input = inputOf(request('eth_sendTransaction', [{ to: ALICE, value: '0x1' }]))
  const result = await render(input, options())
  if (result.kind !== 'transaction') return assert.fail(result.kind)
  assert.deepEqual(result.call, { to: ALICE, data: '0x', value: 1n, display: null, decoded: null, source: null })
})

test('a batch renders each call, and joins the intents', async () => {
  const calls = [
    { to: USDC, data: TRANSFER },
    { to: USDC, data: TRANSFER },
  ]
  const result = await render(inputOf(request('wallet_sendCalls', [{ from: YOU, calls }])), options())
  if (result.kind !== 'batch') return assert.fail(result.kind)
  assert.equal(result.intent, 'Send 1.5 USDC to alice.eth and Send 1.5 USDC to alice.eth')
  assert.deepEqual(
    result.calls.map((call) => call.source?.kind),
    ['registry', 'registry'],
  )
  const mixed = [
    { to: USDC, data: TRANSFER },
    { to: ALICE, value: '0x1' },
  ]
  const partial = await render(inputOf(request('wallet_sendCalls', [{ calls: mixed }])), options())
  if (partial.kind !== 'batch') return assert.fail(partial.kind)
  assert.equal(partial.intent, null)
  assert.equal(partial.warnings[0]?.code, 'BATCH_INTERPOLATION_INCOMPLETE')
  assert.equal(partial.calls[1].display, null)
})

test('typed data renders with its descriptor', async () => {
  const result = await render(inputOf(request('eth_signTypedData_v4', [YOU, typedData])), options())
  if (result.kind !== 'typedData') return assert.fail(result.kind)
  assert.equal(result.display.intent, 'Permit')
  assert.deepEqual(result.source, { kind: 'registry', path: 'registry/circle/eip712-usdc.json' })
  assert.equal(result.account, YOU)
  const other = { ...typedData, domain: { ...typedData.domain, verifyingContract: OTHER } }
  const none = await render(inputOf(request('eth_signTypedData_v4', [YOU, other])), options())
  if (none.kind !== 'typedData') return assert.fail(none.kind)
  assert.equal(reasonOf(none.display)?.code, 'NO_DESCRIPTOR')
  assert.equal(none.source, null)
})

test('formatAmount drops the trailing zeros', () => {
  assert.equal(formatAmount(1_500_000n, 6), '1.5')
  assert.equal(formatAmount(10n ** 18n, 18), '1')
  assert.equal(formatAmount(0n, 18), '0')
  assert.equal(formatAmount(123n, 0), '123')
})
