import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AbiCoder, Interface } from 'ethers'
import type { LogLine } from '../src/gates/gate.ts'
import { MAINNET, providerFor, reverseName, type Reader, type Readers } from '../src/clear-signing/provider.ts'

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const ALICE = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
const REGISTRY = '0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e'
const RESOLVER = '0x4976fb03c32e5b8cfe2b6ccb31c09ba78ebaba41'
const ZERO = '0x0000000000000000000000000000000000000000'

const coder = AbiCoder.defaultAbiCoder()
const ens = new Interface([
  'function resolver(bytes32 node) view returns (address)',
  'function name(bytes32 node) view returns (string)',
  'function addr(bytes32 node) view returns (address)',
])

type Call = { to: string; data: string }

// A chain that answers eth_call from a table: the selector of the call,
// and the ABI-encoded answer. A selector that is not in the table reverts.
function chain(answers: Record<string, (call: Call) => string>, proof = true, code = '0x'): Reader & { calls: Call[] } {
  const calls: Call[] = []
  return {
    proof,
    calls,
    async request(method, params) {
      if (method === 'eth_getCode') return code
      if (method === 'eth_getBlockByNumber') return { timestamp: '0x66000000' }
      if (method !== 'eth_call') throw new Error(`${method} is not expected`)
      const call = (params as Call[])[0]
      calls.push(call)
      const answer = answers[call.data.slice(0, 10)]
      if (!answer) throw new Error('execution reverted')
      return answer(call)
    },
  }
}

const token = (name: string, symbol: string, decimals: number) => ({
  '0x06fdde03': () => coder.encode(['string'], [name]),
  '0x95d89b41': () => coder.encode(['string'], [symbol]),
  '0x313ce567': () => coder.encode(['uint8'], [decimals]),
})

// ENS, with one reverse record: ALICE is "alice.eth", and the forward
// record points to `forward`.
function ensChain(forward: string, proof = true) {
  return chain(
    {
      [ens.getFunction('resolver')!.selector]: (call) =>
        coder.encode(['address'], [call.to.toLowerCase() === REGISTRY ? RESOLVER : ZERO]),
      [ens.getFunction('name')!.selector]: () => coder.encode(['string'], ['alice.eth']),
      [ens.getFunction('addr')!.selector]: () => coder.encode(['address'], [forward]),
    },
    proof,
  )
}

function collect() {
  const lines: LogLine[] = []
  return { lines, log: (line: LogLine) => lines.push(line) }
}

const info = () => ({ name: 'Ethereum mainnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } })

test('resolveToken reads name, symbol and decimals, and says whether a proof checked them', async () => {
  const usdc = chain(token('USD Coin', 'USDC', 6))
  const { lines, log } = collect()
  const provider = providerFor(1, () => usdc, info, log)
  assert.deepEqual(await provider.resolveToken!(1, USDC), { name: 'USD Coin', symbol: 'USDC', decimals: 6 })
  assert.deepEqual(
    usdc.calls.map((call) => call.to),
    [USDC, USDC, USDC],
  )
  assert.match(lines[0].text, /USDC · 6 decimals · read from chain 1 · proof checked/)
  assert.equal(lines[0].proof, true)
})

test('resolveToken answers from the cache the second time, also for another request', async () => {
  const dai = chain(token('Dai', 'DAI', 18), false)
  const { log } = collect()
  const first = providerFor(1, () => dai, info, log)
  const second = providerFor(1, () => dai, info, log)
  const address = '0x6b175474e89094c44da98b954eedeac495271d0f'
  await first.resolveToken!(1, address)
  await second.resolveToken!(1, address.toUpperCase().replace('0X', '0x'))
  assert.equal(dai.calls.length, 3)
})

test('resolveToken gives null when a read fails or the chain is unknown, and does not cache it', async () => {
  const broken = chain({})
  const { lines, log } = collect()
  const provider = providerFor(1, () => broken, info, log)
  const address = '0x2222222222222222222222222222222222222222'
  assert.equal(await provider.resolveToken!(1, address), null)
  assert.equal(await provider.resolveToken!(1, address), null)
  assert.equal(broken.calls.length, 6)
  assert.equal(lines[0].ok, false)
  assert.equal(await providerFor(1, () => null, info, log).resolveToken!(1, address), null)
})

test('reverseName gives the name whose forward record points back to the address', async () => {
  assert.equal(await reverseName(ensChain(ALICE), ALICE), 'alice.eth')
  assert.equal(await reverseName(ensChain(USDC), ALICE), null)
})

test('reverseName gives null without a resolver, or without a name', async () => {
  const noResolver = chain({ [ens.getFunction('resolver')!.selector]: () => coder.encode(['address'], [ZERO]) })
  assert.equal(await reverseName(noResolver, ALICE), null)
  const noName = chain({
    [ens.getFunction('resolver')!.selector]: () => coder.encode(['address'], [RESOLVER]),
    [ens.getFunction('name')!.selector]: () => coder.encode(['string'], ['']),
  })
  assert.equal(await reverseName(noName, ALICE), null)
})

test('resolveEnsName reads mainnet, and checks the type of the address on the chain of the request', async () => {
  const mainnet = ensChain(ALICE)
  const contract = chain({}, true, '0x6080')
  const readers: Readers = (chainId) => (chainId === MAINNET ? mainnet : contract)
  const { lines, log } = collect()
  const provider = providerFor(10, readers, info, log)
  assert.deepEqual(await provider.resolveEnsName!(ALICE, ['eoa']), { name: 'alice.eth', typeMatch: false })
  assert.deepEqual(await provider.resolveEnsName!(ALICE, ['contract']), { name: 'alice.eth', typeMatch: true })
  assert.deepEqual(await provider.resolveEnsName!(ALICE), { name: 'alice.eth', typeMatch: true })
  assert.match(lines[0].text, /alice\.eth · forward record matches · proof checked/)
})

test('resolveEnsName gives null without mainnet in the settings, or when the read fails', async () => {
  const { lines, log } = collect()
  assert.equal(await providerFor(1, () => null, info, log).resolveEnsName!(ALICE), null)
  assert.equal(await providerFor(1, () => chain({}), info, log).resolveEnsName!(ALICE), null)
  assert.equal(lines.at(-1)?.ok, false)
})

test('chainClient runs eth_call on the chain that the library names', async () => {
  const mainnet = chain({ '0x12345678': () => '0xabcd' })
  const { lines, log } = collect()
  const provider = providerFor(10, (chainId) => (chainId === 1 ? mainnet : null), info, log)
  assert.equal(await provider.chainClient!.call(1, { to: USDC, data: '0x12345678' }), '0xabcd')
  assert.match(lines[0].text, /eth_call 0xa0b8…eb48 on chain 1 · proof checked/)
  await assert.rejects(
    provider.chainClient!.call(10, { to: USDC, data: '0x12345678' }),
    /chain 10 is not in the settings/,
  )
  await assert.rejects(provider.chainClient!.call(1, { to: USDC, data: '0x00000000' }), /reverted/)
})

test('resolveBlockTimestamp, resolveNftCollectionName, and resolveChainInfo', async () => {
  const { log } = collect()
  const provider = providerFor(1, () => chain(token('Bored Apes', 'BAYC', 0)), info, log)
  assert.deepEqual(await provider.resolveBlockTimestamp!(1, 20_000_000n), { timestamp: 0x66000000 })
  assert.deepEqual(await provider.resolveNftCollectionName!(1, USDC), { name: 'Bored Apes' })
  assert.deepEqual(await provider.resolveChainInfo!(1), info())
  const unknown = providerFor(
    1,
    () => null,
    () => null,
    log,
  )
  assert.equal(await unknown.resolveBlockTimestamp!(1, 1n), null)
  assert.equal(await unknown.resolveNftCollectionName!(1, USDC), null)
  assert.equal(await unknown.resolveChainInfo!(5), null)
})
