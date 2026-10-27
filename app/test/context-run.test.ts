// A whole context run with a fake network: the explorer rows of each
// contract, the queue, and the requests that must not go out.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ChainConfig } from '../src/chainList.ts'
import type { Contract } from '../src/gates/contracts.ts'
import type { Fetch } from '../src/gates/gate.ts'
import type { ChainRead } from '../src/gates/helios.ts'
import type { Verification } from '../src/gates/run.ts'
import type { Hex } from '../src/messages.ts'
import { RATE_LIMITED, type ExplorerStatus } from '../src/context/explorers.ts'
import {
  changeAction,
  CLAIMS_TTL,
  ETHERSCAN_GAP,
  IN_FLIGHT,
  startContext,
  type Context,
  type Deps,
} from '../src/context/run.ts'
import type { ListState } from '../src/context/lists.ts'
import type { ContextSettings } from '../src/context/settings.ts'

const A: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const B: Hex = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const C: Hex = '0xcccccccccccccccccccccccccccccccccccccccc'
const D: Hex = '0xdddddddddddddddddddddddddddddddddddddddd'
const E: Hex = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678'
const NOW = Date.parse('2026-10-27T12:00:00Z')

const MAINNET: ChainConfig = {
  id: 1,
  name: 'Ethereum mainnet',
  mode: 'helios',
  executionRpc: 'https://rpc.example',
  etherscan: 'https://etherscan.io',
  blockscout: 'https://eth.blockscout.com',
}

const contract = (address: Hex, code: Hex = '0x60', foundBy: Contract['foundBy'] = 'request'): Contract => ({
  address,
  foundBy,
  helios: { status: 'passed', value: { address, block: 100, code } },
  sourcify: { status: 'skipped', reason: 'test' },
})

function verification(contracts: Contract[], chain: ChainConfig | null = MAINNET): Verification {
  return {
    chainId: chain?.id ?? null,
    chain,
    head: { block: 100, checkpoint: null },
    runs: true,
    contracts,
    simulation: { status: 'skipped', reason: 'test' },
    lines: [],
    status: 'passed',
  }
}

// A contract that the simulation found: it gets explorer rows, no
// profile.
const called = (address: Hex) => contract(address, '0x60', 'simulation')

const BLOCKSCOUT_VERIFIED = { is_verified: true, is_fully_verified: true, name: 'Token' }
const ETHERSCAN_VERIFIED = {
  status: '1',
  message: 'OK',
  result: [{ SourceCode: 'x', ABI: '[]', ContractName: 'Token' }],
}

type Answer = { status: number; body: unknown }

// A fake network. `answer` gives the answer for a URL. A held URL waits
// until `release`. It counts the requests in flight on each host.
function network(answer: (url: string) => Answer, hold = false) {
  const calls: string[] = []
  const waits: (() => void)[] = []
  const inFlight = new Map<string, number>()
  const peak = new Map<string, number>()
  const fetch: Fetch = async (url) => {
    calls.push(url)
    const host = new URL(url).host
    inFlight.set(host, (inFlight.get(host) ?? 0) + 1)
    peak.set(host, Math.max(peak.get(host) ?? 0, inFlight.get(host)!))
    if (hold) await new Promise<void>((resolve) => waits.push(resolve))
    inFlight.set(host, inFlight.get(host)! - 1)
    const { status, body } = answer(url)
    return new Response(JSON.stringify(body), { status })
  }
  const release = () => waits.splice(0).forEach((resolve) => resolve())
  return { fetch, calls, peak, release, waiting: () => waits.length }
}

const verifiedEverywhere = (url: string): Answer =>
  url.includes('etherscan') ? { status: 200, body: ETHERSCAN_VERIFIED } : { status: 200, body: BLOCKSCOUT_VERIFIED }

const noChain: ChainRead = async () => {
  throw new Error('no chain in this test')
}

// GoPlus is off unless a test turns it on, and the chain answers
// nothing, so the explorer tests see only explorer requests.
function depsWith(fetch: Fetch, settings: Partial<ContextSettings> = {}, cache = new Map<string, ExplorerStatus>()) {
  const waits: number[] = []
  const deps: Deps = {
    fetch,
    settings: () => ({ etherscanKey: '', goPlus: false, ...settings }),
    now: () => 0,
    date: () => NOW,
    wait: async (ms) => void waits.push(ms),
    cache,
    claims: new Map(),
    chainReaderFor: (chain) => ({ read: noChain, fallback: noChain, proof: chain.mode === 'helios' }),
    creationReaderFor: () => async () => ({ creation: null, reason: 'no chain in this test', retry: false }),
    lists: async () => [],
    registryIndex: async () => ({ calldataIndex: {}, typedDataIndex: {} }),
    tokenLists: () => [],
  }
  return { deps, waits }
}

// The requests for the source code status, not for the profile.
const statusCalls = (calls: string[]) =>
  calls.filter((url) => url.includes('/smart-contracts/') || url.includes('action=getsourcecode'))

function ended(store: ReturnType<typeof startContext>): Promise<Context> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the run did not end')), 1000)
    const check = () => {
      const snapshot = store.getSnapshot()
      if (snapshot.status === 'running') return
      clearTimeout(timer)
      resolve(snapshot)
    }
    store.subscribe(check)
    check()
  })
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const results = (context: Context, address: Hex) =>
  context.explorers[address]?.map((row): [string, ExplorerStatus | null] => [
    row.explorer,
    row.state.status === 'done' ? row.state.result : null,
  ])

test('a named and a called contract without a key: Blockscout for both, no request to Etherscan', async () => {
  const net = network(verifiedEverywhere)
  const { deps } = depsWith(net.fetch)
  const context = await ended(startContext(verification([contract(A), contract(B, '0x61', 'simulation')]), deps))
  assert.ok(net.calls.every((url) => !url.includes('api.etherscan.io')))
  assert.deepEqual(statusCalls(net.calls).sort(), [
    `https://eth.blockscout.com/api/v2/smart-contracts/${A}`,
    `https://eth.blockscout.com/api/v2/smart-contracts/${B}`,
  ])
  for (const address of [A, B]) {
    assert.deepEqual(results(context, address), [
      ['etherscan', { kind: 'no key' }],
      ['blockscout', { kind: 'verified', name: 'Token', partial: false }],
    ])
  }
  const rows = context.explorers[A]!
  assert.equal(rows[0].link, `https://etherscan.io/address/${A}#code`)
  assert.ok(rows.every((row) => row.builtIn))
  assert.equal(rows[1].link, `https://eth.blockscout.com/address/${A}?tab=contract`)
  const lines = context.lines.filter(
    (line) => line.address === A && /^(Etherscan · no API key|Blockscout · [^·]+ · verified)/.test(line.text),
  )
  assert.deepEqual(
    lines.map((line) => [line.source, line.text, line.proof]),
    [
      ['explorer', 'Etherscan · no API key · not asked', undefined],
      ['explorer', 'Blockscout · eth.blockscout.com · verified · Token', false],
    ],
  )
})

test('with a key: Etherscan is asked on the chain id, with a gap between the requests', async () => {
  const net = network(verifiedEverywhere)
  const { deps, waits } = depsWith(net.fetch, { etherscanKey: KEY })
  const context = await ended(startContext(verification([called(A), called(B), called(C)]), deps))
  const etherscan = net.calls.filter((url) => url.startsWith('https://api.etherscan.io/v2/api?chainid=1&'))
  assert.equal(etherscan.length, 3)
  assert.deepEqual(waits, [ETHERSCAN_GAP, ETHERSCAN_GAP, ETHERSCAN_GAP])
  assert.deepEqual(results(context, C)?.[0], ['etherscan', { kind: 'verified', name: 'Token', partial: false }])
  // The key does not show in the log.
  assert.ok(context.lines.every((line) => !line.text.includes(KEY)))
})

test('a request that failed before the chain gate starts no lookup', async () => {
  const failed: Contract = {
    address: A,
    foundBy: 'request',
    helios: { status: 'failed', reason: 'chain 5 is not in the settings' },
    sourcify: { status: 'skipped', reason: 'the chain was not read' },
  }
  const net = network(verifiedEverywhere)
  const { deps } = depsWith(net.fetch, { etherscanKey: KEY })
  const context = await ended(startContext(verification([failed], null), deps))
  assert.deepEqual(net.calls, [])
  assert.deepEqual(context.explorers, {})
  const again = await ended(startContext(verification([failed]), deps))
  assert.deepEqual(net.calls, [])
  assert.deepEqual(again.explorers, {})
})

test('no lookup for an address without code or with a delegate (EIP-7702)', async () => {
  const net = network(verifiedEverywhere)
  const { deps } = depsWith(net.fetch)
  const delegated = contract(A, `0xef0100${'b'.repeat(40)}` as Hex)
  const context = await ended(startContext(verification([delegated, contract(C, '0x')]), deps))
  assert.deepEqual(net.calls, [])
  assert.deepEqual(context.explorers, {})
  // Only the lists and GoPlus look at them.
  assert.deepEqual(Object.keys(context.accounts).sort(), [A, C])
  assert.deepEqual(context.profiles, {})
})

test('a custom chain without explorers has no rows, and says so in the log', async () => {
  const custom: ChainConfig = { id: 777, name: 'Mine', mode: 'rpc', executionRpc: 'https://rpc.mine', custom: true }
  const net = network(verifiedEverywhere)
  const { deps } = depsWith(net.fetch, { etherscanKey: KEY })
  const context = await ended(startContext(verification([called(A)], custom), deps))
  assert.deepEqual(net.calls, [])
  assert.deepEqual(context.explorers[A], [])
  assert.deepEqual(
    context.lines.map((line) => line.text),
    ['no explorer covers chain 777'],
  )
})

test('a chain in RPC mode with an own Blockscout instance: the lookup goes to its API, with no link', async () => {
  const chain: ChainConfig = {
    id: 777,
    name: 'Mine',
    mode: 'rpc',
    executionRpc: 'https://rpc.mine',
    custom: true,
    blockscout: 'https://scout.mine',
    blockscoutApi: 'https://api.scout.mine',
  }
  const net = network(() => ({ status: 404, body: { message: 'Not found' } }))
  const { deps } = depsWith(net.fetch, { etherscanKey: KEY })
  const context = await ended(startContext(verification([called(A)], chain), deps))
  assert.deepEqual(net.calls, [`https://api.scout.mine/api/v2/smart-contracts/${A}`])
  const rows = context.explorers[A]!
  assert.deepEqual(
    rows.map((row) => [row.explorer, row.host, row.builtIn, row.link]),
    [['blockscout', 'https://scout.mine', false, null]],
  )
  assert.deepEqual(results(context, A), [['blockscout', { kind: 'not verified' }]])
})

test('the queue: at most two requests in flight for each explorer', async () => {
  const net = network(verifiedEverywhere, true)
  const { deps } = depsWith(net.fetch, { etherscanKey: KEY })
  const store = startContext(verification([A, B, C, D, E].map((address) => called(address))), deps)
  const run = ended(store)
  // Release the held requests until the run ends.
  while (store.getSnapshot().status === 'running') {
    await tick()
    net.release()
  }
  const context = await run
  assert.equal(net.peak.get('api.etherscan.io'), IN_FLIGHT)
  assert.equal(net.peak.get('eth.blockscout.com'), IN_FLIGHT)
  assert.equal(net.calls.length, 10)
  for (const address of [A, B, C, D, E]) assert.equal(results(context, address)?.[1][1]?.kind, 'verified')
})

test('after a rate limit, the rest of the run asks that explorer nothing', async () => {
  const net = network((url) => {
    if (url.includes('etherscan')) return { status: 200, body: ETHERSCAN_VERIFIED }
    return url.endsWith(A) ? { status: 429, body: {} } : { status: 200, body: BLOCKSCOUT_VERIFIED }
  })
  const { deps } = depsWith(net.fetch, { etherscanKey: KEY })
  const context = await ended(startContext(verification([A, B, C, D, E].map((address) => called(address))), deps))
  const blockscout = net.calls.filter((url) => url.includes('blockscout'))
  // A and B went out together; C, D and E did not go out.
  assert.deepEqual(
    blockscout.sort(),
    [A, B].map((address) => `https://eth.blockscout.com/api/v2/smart-contracts/${address}`),
  )
  const limited = { kind: 'unknown', reason: 'rate limited', limited: true }
  for (const address of [A, C, D, E]) assert.deepEqual(results(context, address)?.[1], ['blockscout', limited])
  assert.equal(results(context, B)?.[1][1]?.kind, 'verified')
  // Etherscan is a queue of its own.
  assert.equal(net.calls.filter((url) => url.includes('etherscan')).length, 5)
  assert.ok(context.lines.some((line) => line.address === D && line.text.endsWith('rate limited · not asked')))
})

test('the session cache: a second run asks no explorer again for a known answer', async () => {
  const net = network((url) =>
    url.endsWith(B) ? { status: 500, body: {} } : { status: 200, body: BLOCKSCOUT_VERIFIED },
  )
  const cache = new Map<string, ExplorerStatus>()
  const { deps } = depsWith(net.fetch, {}, cache)
  await ended(startContext(verification([called(A), called(B)]), deps))
  assert.equal(net.calls.length, 2)
  const context = await ended(startContext(verification([called(A), called(B)]), deps))
  // The answer for A is kept; the error for B is not.
  assert.deepEqual(net.calls.slice(2), [`https://eth.blockscout.com/api/v2/smart-contracts/${B}`])
  assert.ok(context.lines.some((line) => line.address === A && line.text.endsWith('from this session')))
})

test('errors stay unknown and never become not verified', async () => {
  const net = network((url) =>
    url.includes('etherscan')
      ? { status: 200, body: { status: '0', message: 'NOTOK', result: 'Missing/Invalid API Key' } }
      : { status: 502, body: {} },
  )
  const { deps } = depsWith(net.fetch, { etherscanKey: KEY })
  const context = await ended(startContext(verification([called(A)]), deps))
  assert.deepEqual(results(context, A), [
    ['etherscan', { kind: 'unknown', reason: 'the API key is missing or not valid' }],
    ['blockscout', { kind: 'unknown', reason: 'HTTP 502' }],
  ])
})

test('after a rate limit of Etherscan, the lookups that are not asked do not wait', async () => {
  const net = network((url) => {
    if (!url.includes('etherscan')) return { status: 200, body: BLOCKSCOUT_VERIFIED }
    return {
      status: 200,
      body: { status: '0', message: 'NOTOK', result: 'Max calls per sec rate limit reached (3/sec)' },
    }
  })
  const { deps, waits } = depsWith(net.fetch, { etherscanKey: KEY })
  const context = await ended(startContext(verification([A, B, C, D, E].map((address) => called(address))), deps))
  // Only the first two lookups, which started before the limit, waited.
  assert.deepEqual(waits, [ETHERSCAN_GAP, ETHERSCAN_GAP])
  for (const address of [C, D, E]) assert.deepEqual(results(context, address)?.[0][1], RATE_LIMITED)
})

test('a stopped run sends no further request', async () => {
  const net = network(verifiedEverywhere, true)
  const { deps } = depsWith(net.fetch, { etherscanKey: KEY })
  const stop = new AbortController()
  const store = startContext(verification([A, B, C, D, E].map((address) => called(address))), deps, stop.signal)
  const run = ended(store)
  while (net.waiting() < 2 * IN_FLIGHT) await tick()
  stop.abort()
  const sent = net.calls.length
  while (store.getSnapshot().status === 'running') {
    await tick()
    net.release()
  }
  await run
  assert.equal(sent, 2 * IN_FLIGHT)
  assert.equal(net.calls.length, sent)
})

test('the lines of the context count on from the last line of the verification', async () => {
  const net = network(verifiedEverywhere)
  let clock = 70_000
  const { deps } = depsWith(net.fetch, { etherscanKey: KEY })
  deps.now = () => (clock += 10)
  const checked = verification([called(A), called(B)])
  checked.lines = [
    { source: 'helios', text: 'chain ready', at: 400 },
    { source: 'sourcify', text: 'matched', at: 2_500, address: A },
  ]
  const context = await ended(startContext(checked, deps))
  assert.ok(context.lines.length > 0)
  for (const line of context.lines) assert.ok(line.at >= 2_500, `${line.text} at ${line.at}`)
})

// The profile of the named contracts: a fake world with Blockscout,
// GoPlus, Etherscan and the chain.

const DEPLOYER: Hex = '0x36928500bc1dcd7af6a2b4008875cc336b927d57'
const HASH: Hex = '0x2f1c5c2b44f771e942a8506148e256f94f1a464babc938ae0690c6e34cd79190'
const USDC: Hex = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

function blockscoutAnswer(url: string, withCreation = true): Answer {
  if (url.includes('/smart-contracts/')) return { status: 200, body: BLOCKSCOUT_VERIFIED }
  if (url.includes('/tokens?type=ERC-20')) {
    return {
      status: 200,
      body: {
        items: [{ token: { address_hash: USDC, symbol: 'USDC', decimals: '6', type: 'ERC-20' }, value: '25000000' }],
        next_page_params: null,
      },
    }
  }
  if (url.includes('/transactions?')) {
    return { status: 200, body: { items: [{ hash: HASH, block_number: 90, timestamp: '2026-10-20T00:00:00Z' }] } }
  }
  const creation = withCreation ? { creator_address_hash: DEPLOYER, creation_transaction_hash: HASH } : {}
  return { status: 200, body: { name: 'Token', is_scam: false, reputation: 'ok', is_contract: true, ...creation } }
}

const GOPLUS_CLEAN = { code: 1, message: 'ok', result: { sanctioned: '0', data_source: '' } }

function world(answer: (url: string) => Answer = (url) => blockscoutAnswer(url)) {
  return network((url) => {
    if (url.startsWith('https://api.gopluslabs.io/')) return { status: 200, body: GOPLUS_CLEAN }
    if (url.startsWith('https://api.etherscan.io/')) {
      if (url.includes('getcontractcreation')) {
        return {
          status: 200,
          body: {
            status: '1',
            message: 'OK',
            result: [{ contractCreator: DEPLOYER, txHash: HASH, blockNumber: '90', timestamp: '1700000000' }],
          },
        }
      }
      return { status: 200, body: ETHERSCAN_VERIFIED }
    }
    return answer(url)
  })
}

// A chain that answers each read of the profile.
function chainReads() {
  const calls: string[] = []
  const read: ChainRead = async (method, params) => {
    calls.push(method)
    switch (method) {
      case 'eth_getProof':
        return { balance: '0xde0b6b3a7640000' }
      case 'eth_getCode':
        return params[0] === DEPLOYER ? '0x' : '0x60'
      case 'eth_getBlockByNumber':
        // A week before NOW.
        return { number: params[0], timestamp: `0x${((NOW - 7 * 24 * 3600 * 1000) / 1000).toString(16)}` }
      case 'eth_call':
        return `0x${25_000_000n.toString(16).padStart(64, '0')}`
    }
    throw new Error(`unexpected ${method}`)
  }
  return { read, calls }
}

function profileDeps(fetch: Fetch, settings: Partial<ContextSettings> = {}) {
  const { deps, waits } = depsWith(fetch, settings)
  const chain = chainReads()
  deps.chainReaderFor = (config) => ({ read: chain.read, fallback: chain.read, proof: config.mode === 'helios' })
  deps.creationReaderFor = (config) => async (_address, transactionHash) => ({
    creation: {
      transactionHash,
      blockNumber: 90,
      transactionIndex: 0,
      deployer: DEPLOYER,
      input: '0x60',
      verified: config.mode === 'helios',
    },
  })
  return { deps, waits, chain }
}

test('the profile: only the named contract, each row from its source, each read with a log line', async () => {
  const net = world()
  const { deps, chain } = profileDeps(net.fetch, { goPlus: true })
  const context = await ended(startContext(verification([contract(A), called(B)]), deps))
  assert.deepEqual(Object.keys(context.profiles), [A])
  const profile = context.profiles[A]!
  assert.deepEqual(profile.deployment, {
    state: 'known',
    value: { transactionHash: HASH, block: 90 },
    proof: true,
    source: 'Helios',
  })
  assert.equal(profile.deployedAt.state === 'known' && profile.deployedAt.proof, true)
  assert.deepEqual(profile.deployer.address, { state: 'known', value: DEPLOYER, proof: true, source: 'Helios' })
  assert.deepEqual(profile.deployer.kind, { state: 'known', value: 'account', proof: true, source: 'Helios' })
  assert.deepEqual(profile.transactions, {
    state: 'known',
    value: { count: 1, atLeast: false },
    proof: false,
    source: 'Blockscout',
  })
  assert.deepEqual(profile.eth, { state: 'known', value: 10n ** 18n, proof: true, source: 'Helios' })
  const tokens = profile.tokens.state === 'known' ? profile.tokens.value : null
  assert.equal(tokens?.checked, true)
  assert.deepEqual(tokens?.tokens[0].amount, { value: 25_000_000n, proof: true, source: 'Helios' })
  assert.equal(profile.security.goPlus.state, 'known')
  // The young hint: deployed a week before NOW, one transaction.
  assert.deepEqual(profile.young, { days: 7, transactions: 1 })
  // Contract and deployer: balance, code kind, block time, two token amounts.
  assert.deepEqual(chain.calls.sort(), [
    'eth_call',
    'eth_call',
    'eth_getBlockByNumber',
    'eth_getCode',
    'eth_getProof',
    'eth_getProof',
  ])
  // No request for B other than its source code status.
  assert.ok(net.calls.filter((url) => url.includes(B)).every((url) => url.includes('/smart-contracts/')))
  const lines = context.lines.filter((line) => line.address === A)
  const chainLines = lines.filter((line) => line.source === 'helios')
  assert.equal(chainLines.length, chain.calls.length)
  assert.ok(chainLines.every((line) => line.proof === true && line.text.includes('proof checked')))
  const explorerLines = lines.filter(
    (line) => line.source === 'explorer' && /^(deployer · )?Blockscout/.test(line.text),
  )
  // The status, three parts of the contract, three of the deployer.
  assert.equal(explorerLines.length, 7)
  assert.ok(explorerLines.every((line) => line.proof === false))
  assert.ok(lines.some((line) => line.source === 'lists' && line.text === 'GoPlus · no flags' && line.proof === false))
  assert.ok(lines.some((line) => line.source === 'lists' && line.text === 'not on any list'))
  assert.ok(lines.some((line) => line.text === 'deployer · not on any list'))
})

test('GoPlus: no request when the switch is off', async () => {
  const net = world()
  const { deps } = profileDeps(net.fetch, { goPlus: false })
  const context = await ended(startContext(verification([contract(A)]), deps))
  assert.ok(net.calls.every((url) => !url.includes('gopluslabs')))
  assert.deepEqual(context.profiles[A]?.security.goPlus, { state: 'off' })
  assert.ok(context.lines.some((line) => line.text === 'GoPlus · off in the settings · not asked'))
})

const ofacWith = (address: Hex): ListState => ({
  id: 'ofac',
  enabled: true,
  fetchedAt: 1,
  chains: [],
  error: null,
  entries: [{ chainId: null, address, label: 'sanctioned · ETH' }],
})

test('a block-list hit: a notice on the profile, a log line, no other change', async () => {
  const net = world()
  const { deps } = profileDeps(net.fetch)
  deps.lists = async () => [ofacWith(A)]
  const checked = verification([contract(A)])
  const context = await ended(startContext(checked, deps))
  assert.deepEqual(context.profiles[A]?.blocked, [
    { value: 'sanctioned · ETH', proof: false, source: 'OFAC sanctions', of: 'address' },
  ])
  assert.ok(
    context.lines.some(
      (line) => line.source === 'lists' && line.text === 'on a block list · OFAC sanctions · sanctioned · ETH',
    ),
  )
  assert.equal(checked.status, 'passed')
})

test('a chain in RPC mode: each chain read is a claim of the endpoint', async () => {
  const chain: ChainConfig = { ...MAINNET, mode: 'rpc', executionRpc: 'https://rpc.example' }
  const net = world()
  const { deps } = profileDeps(net.fetch)
  const context = await ended(startContext(verification([contract(A)], chain), deps))
  const profile = context.profiles[A]!
  assert.deepEqual(profile.eth, {
    state: 'known',
    value: 10n ** 18n,
    proof: false,
    source: 'rpc.example without proof',
  })
  assert.equal(profile.deployment.state === 'known' && profile.deployment.proof, false)
  const chainLines = context.lines.filter((line) => line.source === 'rpc')
  assert.ok(chainLines.length > 0)
  assert.ok(chainLines.every((line) => line.proof === false && line.text.includes('from rpc.example · no proof')))
  assert.ok(context.lines.every((line) => line.source !== 'helios'))
})

test('the session cache: a second run asks Blockscout nothing again for the profile', async () => {
  const net = world()
  const { deps } = profileDeps(net.fetch)
  await ended(startContext(verification([contract(A)]), deps))
  const first = net.calls.filter((url) => url.includes('/api/v2/addresses/')).length
  // Three parts for the contract and three for the deployer.
  assert.equal(first, 6)
  const context = await ended(startContext(verification([contract(A)]), deps))
  assert.equal(net.calls.filter((url) => url.includes('/api/v2/addresses/')).length, first)
  assert.ok(context.lines.some((line) => line.text.endsWith('· from this session') && line.text.includes('address')))
  assert.equal(context.profiles[A]?.transactions.state, 'known')
})

test('the session cache: Blockscout claims older than the TTL are asked again', async () => {
  const net = world()
  const { deps } = profileDeps(net.fetch)
  let date = NOW
  deps.date = () => date
  const parts = () => net.calls.filter((url) => url.includes('/api/v2/addresses/')).length
  await ended(startContext(verification([contract(A)]), deps))
  const first = parts()
  date = NOW + CLAIMS_TTL - 1
  await ended(startContext(verification([contract(A)]), deps))
  assert.equal(parts(), first)
  date = NOW + CLAIMS_TTL
  await ended(startContext(verification([contract(A)]), deps))
  assert.equal(parts(), 2 * first)
})

test('the session cache: an address that Blockscout does not know is asked again', async () => {
  const net = world((url) =>
    url.includes(A) ? { status: 404, body: { message: 'Not found' } } : blockscoutAnswer(url),
  )
  const { deps } = profileDeps(net.fetch)
  const asked = () => net.calls.filter((url) => url.includes(`/api/v2/addresses/${A}`)).length
  await ended(startContext(verification([contract(A)]), deps))
  const first = asked()
  assert.equal(first, 3)
  await ended(startContext(verification([contract(A)]), deps))
  assert.equal(asked(), 2 * first)
})

test('Etherscan: no profile request without a key; with one, the creation when Blockscout names none', async () => {
  const noCreation = world((url) => blockscoutAnswer(url, false))
  const { deps } = profileDeps(noCreation.fetch)
  const without = await ended(startContext(verification([contract(A)]), deps))
  assert.ok(noCreation.calls.every((url) => !url.includes('etherscan')))
  assert.equal(without.profiles[A]?.deployment.state, 'unknown')
  const keyed = world((url) => blockscoutAnswer(url, false))
  const withKey = profileDeps(keyed.fetch, { etherscanKey: KEY })
  const context = await ended(startContext(verification([contract(A)]), withKey.deps))
  assert.equal(keyed.calls.filter((url) => url.includes('getcontractcreation')).length, 1)
  // The read of the transaction that Etherscan names has the proof.
  assert.deepEqual(context.profiles[A]?.deployer.address, {
    state: 'known',
    value: DEPLOYER,
    proof: true,
    source: 'Helios',
  })
  // With a Blockscout claim, Etherscan is not asked for the creation.
  const claimed = world()
  await ended(startContext(verification([contract(A)]), profileDeps(claimed.fetch, { etherscanKey: KEY }).deps))
  assert.ok(claimed.calls.every((url) => !url.includes('getcontractcreation')))
})

test('a rate limit of Blockscout: the profile parts after it are not asked', async () => {
  const net = world((url) => (url.includes('/smart-contracts/') ? { status: 429, body: {} } : blockscoutAnswer(url)))
  const { deps } = profileDeps(net.fetch)
  const context = await ended(startContext(verification([contract(A)]), deps))
  // Only the requests that were in line before the answer went out.
  const blockscout = net.calls.filter((url) => url.includes('blockscout'))
  assert.equal(blockscout[0], `https://eth.blockscout.com/api/v2/smart-contracts/${A}`)
  assert.ok(blockscout.length <= 1 + IN_FLIGHT, blockscout.join(' '))
  const profile = context.profiles[A]!
  assert.deepEqual(profile.tokens, { state: 'unknown', reason: 'rate limited · not asked' })
  assert.deepEqual(profile.firstTransaction, { state: 'unknown', reason: 'rate limited · not asked' })
  // The chain reads do not depend on the explorer.
  assert.equal(profile.eth.state, 'known')
})

test('the queue: the profile shares the two slots of each explorer', async () => {
  const net = network((url) => blockscoutAnswer(url), true)
  const { deps } = profileDeps(net.fetch)
  const store = startContext(verification([A, B, C].map((address) => contract(address))), deps)
  const run = ended(store)
  while (store.getSnapshot().status === 'running') {
    await tick()
    net.release()
  }
  const context = await run
  assert.equal(net.peak.get('eth.blockscout.com'), IN_FLIGHT)
  assert.deepEqual(Object.keys(context.profiles).sort(), [A, B, C])
  // The status lookups come first in the line.
  assert.ok(net.calls.slice(0, 3).every((url) => url.includes('/smart-contracts/')))
})

test('a profile row that waits shows pending until the run ends', async () => {
  const net = network((url) => blockscoutAnswer(url), true)
  const { deps } = profileDeps(net.fetch)
  const store = startContext(verification([contract(A)]), deps)
  await tick()
  assert.equal(store.getSnapshot().profiles[A]?.transactions.state, 'pending')
  const stop = ended(store)
  while (store.getSnapshot().status === 'running') {
    await tick()
    net.release()
  }
  const context = await stop
  assert.notEqual(context.profiles[A]?.transactions.state, 'pending')
})

test('a list with an error and no entries, and a registry that failed: missing, not "not on any list"', async () => {
  const net = world()
  const { deps } = profileDeps(net.fetch)
  deps.lists = async () => [
    { ...ofacWith(B), fetchedAt: null, entries: [], error: 'sanctioned_addresses_ETH.json · HTTP 503' },
  ]
  deps.registryIndex = async () => {
    throw new Error('the index did not load')
  }
  const context = await ended(startContext(verification([contract(A)]), deps))
  const lists = context.profiles[A]?.lists
  assert.deepEqual(lists?.state === 'known' && lists.value, {
    hits: [],
    missing: [
      { list: 'OFAC sanctions', reason: 'sanctioned_addresses_ETH.json · HTTP 503' },
      { list: 'ERC-7730 registry', reason: 'the index did not load' },
    ],
    asked: [],
  })
  assert.ok(
    context.lines.some(
      (line) =>
        line.address === A &&
        line.text ===
          'not on any list · OFAC sanctions not loaded: sanctioned_addresses_ETH.json · HTTP 503 · ERC-7730 registry not loaded: the index did not load',
    ),
  )
})

test('the run waits for the lists: the row is pending until they come', async () => {
  const net = world()
  const { deps } = profileDeps(net.fetch)
  let release = (_states: ListState[]) => {}
  deps.lists = () => new Promise((resolve) => (release = resolve))
  const store = startContext(verification([contract(A)]), deps)
  for (let i = 0; i < 20; i++) await tick()
  assert.equal(store.getSnapshot().profiles[A]?.lists.state, 'pending')
  release([ofacWith(A)])
  const context = await ended(store)
  assert.equal(context.profiles[A]?.blocked[0]?.source, 'OFAC sanctions')
})

test('a block-list hit on the deployer is on the profile, with the deployer named', async () => {
  const net = world()
  const { deps } = profileDeps(net.fetch)
  deps.lists = async () => [ofacWith(DEPLOYER)]
  const context = await ended(startContext(verification([contract(A)]), deps))
  assert.deepEqual(context.profiles[A]?.blocked, [
    { value: 'sanctioned · ETH', proof: false, source: 'OFAC sanctions', of: 'deployer' },
  ])
  assert.ok(
    context.lines.some((line) => line.text === 'deployer · on a block list · OFAC sanctions · sanctioned · ETH'),
  )
})

test('a named account without code on a block list: a small result, no explorer request', async () => {
  const net = world()
  const { deps } = profileDeps(net.fetch, { goPlus: true })
  deps.lists = async () => [ofacWith(A)]
  const context = await ended(startContext(verification([contract(A, '0x')]), deps))
  assert.deepEqual(context.profiles, {})
  const account = context.accounts[A]!
  assert.deepEqual(account.blocked, [
    { value: 'sanctioned · ETH', proof: false, source: 'OFAC sanctions', of: 'address' },
  ])
  assert.equal(account.goPlus.state, 'known')
  // GoPlus only: no explorer, no chain read.
  assert.deepEqual(net.calls, [`https://api.gopluslabs.io/api/v1/address_security/${A}?chain_id=1`])
  assert.ok(
    context.lines.some(
      (line) => line.address === A && line.text === 'on a block list · OFAC sanctions · sanctioned · ETH',
    ),
  )
})

test('a named account not on a list, with a list missing: the missing list is named', async () => {
  const net = world()
  const { deps } = profileDeps(net.fetch)
  deps.lists = async () => [{ ...ofacWith(B), fetchedAt: null, entries: [], error: 'HTTP 503' }]
  const context = await ended(startContext(verification([contract(A, '0x')]), deps))
  const lists = context.accounts[A]?.lists
  assert.deepEqual(lists?.state === 'known' && lists.value, {
    hits: [],
    missing: [{ list: 'OFAC sanctions', reason: 'HTTP 503' }],
    asked: ['ERC-7730 registry'],
  })
  assert.ok(context.lines.some((line) => line.text === 'not on any list · OFAC sanctions not loaded: HTTP 503'))
})

test('an account with a delegate: one account entry; the delegate gets no profile', async () => {
  const net = world()
  const { deps } = profileDeps(net.fetch)
  const account = contract(A, `0xef0100${B.slice(2)}` as Hex)
  const delegate: Contract = { ...contract(B), implementationOf: A }
  const context = await ended(startContext(verification([account, delegate]), deps))
  assert.deepEqual(Object.keys(context.accounts), [A])
  assert.deepEqual(context.profiles, {})
  // The delegate has code: its source code status is looked up.
  assert.ok(context.explorers[B])
})

test('a named address that the chain gate did not read: the lists still check it', async () => {
  const net = world()
  const { deps } = profileDeps(net.fetch, { goPlus: true })
  deps.lists = async () => [ofacWith(A)]
  const unread: Contract = { ...contract(A), helios: { status: 'failed', reason: 'the endpoint did not answer' } }
  const context = await ended(startContext(verification([unread]), deps))
  assert.deepEqual(context.profiles, {})
  assert.deepEqual(context.explorers, {})
  assert.equal(context.accounts[A]?.blocked.length, 1)
  assert.deepEqual(net.calls, [`https://api.gopluslabs.io/api/v1/address_security/${A}?chain_id=1`])
})

test('the lines of the source code status carry the status topic, the profile lines do not', async () => {
  const net = world()
  const { deps } = profileDeps(net.fetch)
  const context = await ended(startContext(verification([contract(A), called(C)]), deps))
  const status = context.lines.filter((line) => line.topic === 'status')
  assert.deepEqual(
    status.map((line) => [line.address, line.text]),
    [
      [A, 'Etherscan · no API key · not asked'],
      [C, 'Etherscan · no API key · not asked'],
      [A, 'Blockscout · eth.blockscout.com · verified · Token'],
      [C, 'Blockscout · eth.blockscout.com · verified · Token'],
    ],
  )
  const profile = context.lines.filter((line) => line.address === A && line.topic === undefined)
  assert.ok(
    profile.some(
      (line) => line.source === 'explorer' && line.text.startsWith('Blockscout · eth.blockscout.com · address'),
    ),
  )
  assert.ok(profile.every((line) => !line.text.includes('verified · Token')))
})

test('changeAction: a run again only for new lists, and later for a store that nobody watches', () => {
  const read = {}
  assert.equal(changeAction({ kind: 'settings' }, true), 'rerun')
  assert.equal(changeAction({ kind: 'settings' }, false), 'later')
  // The run waits for the lists and reads the new ones.
  assert.equal(changeAction({ kind: 'lists', read: null, now: {} }, true), 'none')
  // The run read these lists already.
  assert.equal(changeAction({ kind: 'lists', read, now: read }, true), 'none')
  assert.equal(changeAction({ kind: 'lists', read, now: {} }, true), 'rerun')
  assert.equal(changeAction({ kind: 'lists', read, now: {} }, false), 'later')
})

test('a request that waits in the Blockscout queue starts no timer before it goes out', async () => {
  const net = network((url) => blockscoutAnswer(url), true)
  const { deps } = profileDeps(net.fetch)
  const timeout = AbortSignal.timeout
  let timers = 0
  AbortSignal.timeout = (ms: number) => {
    timers += 1
    return timeout(ms)
  }
  try {
    const store = startContext(verification([A, B, C].map((address) => contract(address))), deps)
    const run = ended(store)
    while (store.getSnapshot().status === 'running') {
      await tick()
      // Each timer belongs to a request that went out.
      assert.equal(timers, net.calls.length)
      assert.ok(net.waiting() <= IN_FLIGHT)
      net.release()
    }
    await run
  } finally {
    AbortSignal.timeout = timeout
  }
})
