// The address lists of the profile: each parser on an excerpt of the real
// file (2026-10-27), the hits, and the store with a fake storage.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ListEntry } from '../src/clear-signing/tokenLists.ts'
import {
  createAddressListStore,
  erc7730Hits,
  fetchSource,
  hitsFor,
  isStale,
  LIST_SOURCES,
  missingFor,
  missingText,
  missingTokenLists,
  newState,
  parseOfac,
  parseSafe,
  parseScamSniffer,
  parseStates,
  parseUniswap,
  REFRESH_AFTER,
  SAFE_FILES,
  sourceOf,
  STORAGE_KEY,
  tokenListHits,
  type ListState,
  type Storage,
} from '../src/context/lists.ts'
import type { Fetch } from '../src/gates/gate.ts'
import type { Hex } from '../src/messages.ts'

const SAFE_130 = '0xd9db270c1b5e3bd161e8c8503c55ceabee709552'
const SAFE_130_EIP155 = '0x69f4d1788e39c87893c980c06edf4b7f686e2938'
const SAFE_141 = '0x41675c099f32341bf84bfc5382af534df5c7461a'
const ROUTER = '0x23617e59a5925b2a4bf75d73ff6711cd0b29de85'
const SANCTIONED = '0x0330070fd38ec3bb94f58fa55d40368271e9e54a'
const SCAM = '0x101ce0cedd142f199c9ef61739ae59b6611a0fc0'

// src/assets/v1.3.0/gnosis_safe.json: a list of types for some chains, one
// type for others, and an ABI.
const gnosisSafe = {
  released: true,
  contractName: 'GnosisSafe',
  version: '1.3.0',
  deployments: {
    canonical: { address: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552', codeHash: '0xbba6' },
    eip155: { address: '0x69f4D1788e39c87893C980c06EdF4b7f686e2938', codeHash: '0xbba6' },
    zksync: { address: '0xB00ce5CCcdEf57e539ddcEd01DF43a13855d9910', codeHash: '0x551b' },
  },
  networkAddresses: { '1': ['canonical', 'eip155'], '3': 'canonical', '10': ['eip155', 'canonical'], '324': 'zksync' },
  abi: [{ type: 'function', name: 'execTransaction' }],
}

// src/assets/v1.4.1/safe.json.
const safe141 = {
  released: true,
  contractName: 'Safe',
  version: '1.4.1',
  deployments: {
    canonical: { address: '0x41675C099F32341bf84BFc5382aF534df5C7461a', codeHash: '0x1fe2' },
    zksync: { address: '0xC35F063962328aC65cED5D4c3fC5dEf8dec68dFa', codeHash: '0xfa4d' },
  },
  networkAddresses: { '1': 'canonical', '5': 'canonical', '10': 'canonical' },
  abi: [],
}

// deployments/json/1.json of Uniswap/contracts.
const uniswap1 = {
  chainId: '1',
  latest: {
    UniversalRouter: {
      address: '0x23617e59A5925b2A4Bf75d73ff6711cD0b29De85',
      proxy: false,
      deploymentTxn: '0x350510f7398242ffc778c086ae6bbe9cc744c33a04468f1a7978e54164638257',
      timestamp: 1789681571000,
      commitHash: '802fe4c',
    },
    Permit2: { address: '0x000000000022D473030F116dDEE9F6B43aC78BA3', proxy: false },
    Broken: { address: 'none' },
  },
  history: [
    {
      contracts: { 'PermissionedPositionManager#cb38eb1a': { address: '0xd7be746b6b29f6185a01013e944313e1704c971f' } },
    },
  ],
}

// sanctioned_addresses_USDT.json: EVM and TRON addresses, mixed case.
const ofacUsdt = [
  '0x175d44451403Edf28469dF03A9280c1197ADb92c',
  '0x19aa5fe80d33a56d56c78e82ea5e50e5d80b4dff',
  'TYD6a4PAAfAgegEdDf9oZUnW4DFmS8jeFT',
]
const ofacEth = ['0x0330070FD38Ec3bB94F58FA55D40368271E9e54A', '0x038989cbb1710c72b9920dc4fa529158f463e72c']

// blacklist/address.json of ScamSniffer.
const scamSniffer = ['0x101ce0cedd142f199c9ef61739ae59b6611a0fc0', '0x43412801d29861ecc4c4d86e5becfd16af86a67b']

test('Safe: one entry for each type on each chain of the settings; the ABI is not kept', () => {
  const entries = parseSafe(gnosisSafe, { url: 'x' }, [1, 10, 42161])
  assert.deepEqual(entries, [
    { chainId: 1, address: SAFE_130, label: 'GnosisSafe v1.3.0' },
    { chainId: 1, address: SAFE_130_EIP155, label: 'GnosisSafe v1.3.0' },
    { chainId: 10, address: SAFE_130_EIP155, label: 'GnosisSafe v1.3.0' },
    { chainId: 10, address: SAFE_130, label: 'GnosisSafe v1.3.0' },
  ])
  assert.ok(!JSON.stringify(entries).includes('execTransaction'))
  assert.deepEqual(parseSafe(safe141, { url: 'x' }, [5]), [{ chainId: 5, address: SAFE_141, label: 'Safe v1.4.1' }])
  assert.throws(() => parseSafe({ ...safe141, version: undefined }, { url: 'x' }, [1]), /no contract name/)
  assert.throws(() => parseSafe([], { url: 'x' }, [1]), /not an object/)
})

test('Safe: the 18 core files, with the file names of v1.3.0', () => {
  assert.equal(SAFE_FILES.length, 18)
  assert.ok(SAFE_FILES.includes('v1.3.0/gnosis_safe_l2.json'))
  assert.ok(SAFE_FILES.includes('v1.3.0/proxy_factory.json'))
  assert.ok(SAFE_FILES.includes('v1.5.0/safe_proxy_factory.json'))
  assert.ok(!SAFE_FILES.includes('v1.3.0/safe.json'))
})

test('Uniswap: the latest contracts of the chain of the file', () => {
  const file = { url: 'x', chainId: 1 }
  assert.deepEqual(parseUniswap(uniswap1, file), [
    { chainId: 1, address: ROUTER, label: 'UniversalRouter' },
    { chainId: 1, address: '0x000000000022d473030f116ddee9f6b43ac78ba3', label: 'Permit2' },
  ])
  assert.throws(() => parseUniswap(uniswap1, { url: 'x', chainId: 10 }), /another chain/)
})

test('OFAC and ScamSniffer: EVM addresses only, on every chain', () => {
  const usdt = parseOfac(ofacUsdt, { url: 'https://example/sanctioned_addresses_USDT.json' })
  assert.deepEqual(usdt, [
    { chainId: null, address: '0x175d44451403edf28469df03a9280c1197adb92c', label: 'sanctioned · USDT' },
    { chainId: null, address: '0x19aa5fe80d33a56d56c78e82ea5e50e5d80b4dff', label: 'sanctioned · USDT' },
  ])
  assert.deepEqual(parseScamSniffer(scamSniffer)[0], { chainId: null, address: SCAM, label: 'scam address' })
  assert.throws(() => parseScamSniffer({ addresses: [] }), /not an array/)
})

// A fake network over the files of each source.
function network(files: Record<string, { status?: number; body: unknown }>) {
  const calls: string[] = []
  const fetch: Fetch = async (url) => {
    calls.push(url)
    const file = Object.entries(files).find(([end]) => url.endsWith(end))?.[1]
    if (!file) return new Response('404: Not Found', { status: 404 })
    return new Response(JSON.stringify(file.body), { status: file.status ?? 200 })
  }
  return { fetch, calls }
}

test('fetchSource: a chain without a Uniswap file has no entries; another error fails the source', async () => {
  const uniswap = sourceOf('uniswap')
  const net = network({ '/1.json': { body: uniswap1 } })
  const entries = await fetchSource(uniswap, [1, 560048], net.fetch)
  assert.equal(entries.length, 2)
  assert.deepEqual(net.calls, [
    'https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/1.json',
    'https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/560048.json',
  ])
  const ofac = sourceOf('ofac')
  await assert.rejects(fetchSource(ofac, [1], network({ '_ETH.json': { body: ofacEth } }).fetch), /HTTP 404/)
  const all = network({
    '_ETH.json': { body: ofacEth },
    '_USDC.json': { body: [] },
    '_USDT.json': { body: ofacUsdt },
    '_ARB.json': { body: ['0x4f47bc496083c727c5fbe3ce9cdf2b0f6496270c'] },
    '_BSC.json': { body: ['0x4F47BC496083C727C5FBE3CE9CDF2B0F6496270C'] },
  })
  const sanctioned = await fetchSource(ofac, [1], all.fetch)
  // The same address on two lists is one entry.
  assert.equal(sanctioned.length, 5)
  await assert.rejects(
    fetchSource(sourceOf('scamsniffer'), [1], network({ 'address.json': { body: { not: 'a list' } } }).fetch),
    /address.json · the file is not an array/,
  )
})

const state = (id: ListState['id'], entries: ListState['entries'], enabled = true): ListState => ({
  ...newState(id),
  enabled,
  fetchedAt: 1,
  entries,
})

test('hitsFor: by chain and on every chain, case-insensitive, enabled sources only', () => {
  const states = [
    state('safe', parseSafe(gnosisSafe, { url: 'x' }, [1, 10])),
    state('uniswap', parseUniswap(uniswap1, { url: 'x', chainId: 1 })),
    state('ofac', parseOfac(ofacEth, { url: 'sanctioned_addresses_ETH.json' })),
    state('scamsniffer', parseScamSniffer(scamSniffer), false),
  ]
  assert.deepEqual(hitsFor(states, 10, SAFE_130.toUpperCase().replace('0X', '0x') as Hex), [
    {
      list: 'Safe deployments',
      kind: 'allow',
      label: 'GnosisSafe v1.3.0',
      link: 'https://github.com/safe-global/safe-deployments',
    },
  ])
  assert.deepEqual(hitsFor(states, 42161, SAFE_130), [])
  assert.deepEqual(
    hitsFor(states, 1, ROUTER).map((hit) => hit.label),
    ['UniversalRouter'],
  )
  assert.deepEqual(hitsFor(states, 10, ROUTER), [])
  const sanctioned = hitsFor(states, 42161, '0x0330070FD38Ec3bB94F58FA55D40368271E9e54A')
  assert.deepEqual(
    sanctioned.map((hit) => [hit.list, hit.kind, hit.label]),
    [['OFAC sanctions', 'block', 'sanctioned · ETH']],
  )
  // ScamSniffer is off.
  assert.deepEqual(hitsFor(states, 1, SCAM), [])
})

test('erc7730Hits: the owner of each descriptor of the address, no fetch', () => {
  const index = {
    calldataIndex: { 'eip155:1:0xff51a5898e281db6dfc7855790607438df2ca44b': 'registry/safe/calldata-Safe-1.5.0.json' },
    typedDataIndex: {
      'eip155:1:0xff51a5898e281db6dfc7855790607438df2ca44b': { SafeTx: [{ path: 'registry/safe/eip712-Safe.json' }] },
      'eip155:1:0x000000000022d473030f116ddee9f6b43ac78ba3': {
        PermitSingle: [{ path: 'registry/uniswap/eip712-permit2.json' }],
      },
    },
  } as unknown as Parameters<typeof erc7730Hits>[0]
  assert.deepEqual(erc7730Hits(index, 1, '0xFf51A5898e281Db6DfC7855790607438dF2ca44b'), [
    {
      list: 'ERC-7730 registry',
      kind: 'allow',
      label: 'safe',
      link: 'https://github.com/ethereum/clear-signing-erc7730-registry/tree/master/registry/safe',
    },
  ])
  assert.deepEqual(
    erc7730Hits(index, 1, '0x000000000022d473030f116ddee9f6b43ac78ba3').map((hit) => hit.label),
    ['uniswap'],
  )
  assert.deepEqual(erc7730Hits(index, 10, '0xff51a5898e281db6dfc7855790607438df2ca44b'), [])
})

test('tokenListHits: through the token lists of the user', () => {
  const entries: ListEntry[] = [
    {
      url: 'https://tokens.uniswap.org',
      list: {
        name: 'Uniswap Labs Default',
        version: { major: 1, minor: 0, patch: 0 },
        timestamp: '',
        tokens: [{ chainId: 1, address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT', decimals: 6 }],
      },
      held: null,
      fetchedAt: 1,
      error: null,
    },
  ]
  assert.deepEqual(tokenListHits(entries, 1, '0xdAC17F958D2ee523a2206206994597C13D831ec7'), [
    { list: 'Uniswap Labs Default', kind: 'allow', label: 'token', link: 'https://tokens.uniswap.org' },
  ])
  assert.deepEqual(tokenListHits(entries, 10, '0xdac17f958d2ee523a2206206994597c13d831ec7'), [])
})

test('isStale: after a day, or when the chains changed', () => {
  const fetched = { ...newState('uniswap'), fetchedAt: 1000, chains: [1, 10] }
  assert.equal(isStale(newState('ofac'), [1], 0), true)
  assert.equal(isStale(fetched, [10, 1], 1000 + REFRESH_AFTER - 1), false)
  assert.equal(isStale(fetched, [1, 10], 1000 + REFRESH_AFTER), true)
  assert.equal(isStale(fetched, [1], 2000), true)
  // A source for every chain does not depend on the chains.
  const ofac = { ...newState('ofac'), fetchedAt: 1000, chains: [1] }
  assert.equal(isStale(ofac, [1, 10], 2000), false)
})

test('missingFor: an enabled source without data for the chain, and why', () => {
  const entry = { chainId: null, address: SANCTIONED as Hex, label: 'sanctioned · ETH' }
  const states: ListState[] = [
    // A failed first fetch.
    { ...newState('ofac'), error: 'sanctioned_addresses_ETH.json · HTTP 503' },
    // A failed fetch that keeps the last good copy is not missing.
    { ...newState('scamsniffer'), fetchedAt: 5, error: 'HTTP 500', entries: [entry] },
    // Fetched for chain 1 only.
    { ...newState('uniswap'), fetchedAt: 5, chains: [1] },
    // Off: not asked.
    { ...newState('safe'), enabled: false },
  ]
  assert.deepEqual(missingFor(states, 10), [
    { list: 'OFAC sanctions', reason: 'sanctioned_addresses_ETH.json · HTTP 503' },
    { list: 'Uniswap deployments', reason: 'not fetched for chain 10' },
  ])
  assert.deepEqual(missingFor(states, 1), [
    { list: 'OFAC sanctions', reason: 'sanctioned_addresses_ETH.json · HTTP 503' },
  ])
  // An error after a good fetch with no entries.
  const empty = { ...newState('scamsniffer'), fetchedAt: 5, error: 'HTTP 500' }
  assert.deepEqual(missingFor([empty], 1), [{ list: 'ScamSniffer', reason: 'HTTP 500' }])
  assert.deepEqual(missingFor([newState('ofac')], 1), [{ list: 'OFAC sanctions', reason: 'not fetched yet' }])
  assert.equal(
    missingText(missingFor([newState('ofac'), empty], 1)),
    'OFAC sanctions not loaded: not fetched yet · ScamSniffer not loaded: HTTP 500',
  )
})

test('missingTokenLists: a token list of the user without a list', () => {
  const entries: ListEntry[] = [
    { url: 'https://tokens.uniswap.org', list: null, held: null, fetchedAt: null, error: 'HTTP 500' },
    { url: 'https://example.org/list.json', list: null, held: null, fetchedAt: null, error: null },
  ]
  assert.deepEqual(missingTokenLists(entries), [
    { list: 'tokens.uniswap.org', reason: 'HTTP 500' },
    { list: 'example.org', reason: 'not fetched yet' },
  ])
})

test('parseStates: one state for each source; bad entries and fields are dropped', () => {
  const states = parseStates([
    {
      id: 'ofac',
      enabled: false,
      fetchedAt: 5,
      chains: [1, 'x'],
      error: null,
      entries: [
        { chainId: null, address: SANCTIONED, label: 'sanctioned · ETH' },
        { chainId: 0, address: SANCTIONED, label: 'bad chain' },
        { chainId: 1, address: 'TYD6a4PAAfAgegEdDf9oZUnW4DFmS8jeFT', label: 'tron' },
        { chainId: 1, address: SANCTIONED },
      ],
    },
    { id: 'unknown source', enabled: false },
  ])
  assert.deepEqual(
    states.map((item) => item.id),
    LIST_SOURCES.map((source) => source.id),
  )
  const ofac = states.find((item) => item.id === 'ofac')!
  assert.equal(ofac.enabled, false)
  assert.deepEqual(ofac.chains, [1])
  assert.deepEqual(ofac.entries, [{ chainId: null, address: SANCTIONED, label: 'sanctioned · ETH' }])
  assert.ok(states.filter((item) => item.id !== 'ofac').every((item) => item.enabled && item.fetchedAt === null))
  assert.equal(parseStates('garbage').length, LIST_SOURCES.length)
})

const throwing: Storage = {
  getItem() {
    throw new Error('no storage')
  },
  setItem() {
    throw new Error('no storage')
  },
}

test('the store: works with a storage that throws, and refreshes the stale sources', async () => {
  const net = network({
    'address.json': { body: scamSniffer },
    '_ETH.json': { body: ofacEth },
    '_USDC.json': { body: [] },
    '_USDT.json': { body: ofacUsdt },
    '_ARB.json': { body: [] },
    '_BSC.json': { body: [] },
    '/1.json': { body: uniswap1 },
    ...Object.fromEntries(SAFE_FILES.map((path) => [path, { body: safe141 }])),
  })
  const store = createAddressListStore({ storage: () => throwing, fetch: net.fetch, now: () => 1000 })
  let changes = 0
  store.subscribe(() => (changes += 1))
  await store.refreshStale([1])
  assert.ok(changes >= 4)
  const byId = Object.fromEntries(store.getSnapshot().map((item) => [item.id, item]))
  assert.equal(byId.scamsniffer.entries.length, 2)
  assert.equal(byId.ofac.entries.length, 4)
  assert.equal(byId.uniswap.entries.length, 2)
  assert.deepEqual(byId.safe.entries, [{ chainId: 1, address: SAFE_141, label: 'Safe v1.4.1' }])
  assert.ok(store.getSnapshot().every((item) => item.fetchedAt === 1000 && item.error === null))
  // Fresh: no second fetch.
  const sent = net.calls.length
  await store.refreshStale([1])
  assert.equal(net.calls.length, sent)
})

test('the store: a failed fetch keeps the last copy and the error; a disabled source is not fetched', async () => {
  const saved = new Map<string, string>()
  const storage: Storage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => void saved.set(key, value),
  }
  const old = [state('scamsniffer', parseScamSniffer(scamSniffer))]
  saved.set(STORAGE_KEY, JSON.stringify(old.map((item) => ({ ...item, fetchedAt: 0 }))))
  const now = REFRESH_AFTER + 1
  const net = network({ 'address.json': { status: 500, body: {} } })
  const store = createAddressListStore({ storage: () => storage, fetch: net.fetch, now: () => now })
  for (const source of LIST_SOURCES) if (source.id !== 'scamsniffer') store.setEnabled(source.id, false)
  await store.refreshStale([1])
  assert.ok(net.calls.every((url) => url.endsWith('blacklist/address.json')))
  const scam = store.getSnapshot().find((item) => item.id === 'scamsniffer')!
  assert.equal(scam.entries.length, 2)
  assert.equal(scam.fetchedAt, 0)
  assert.match(scam.error ?? '', /HTTP 500/)
  // The saved copy holds the parsed entries only, and survives a reload.
  const reloaded = createAddressListStore({ storage: () => storage, fetch: net.fetch, now: () => now })
  const again = reloaded.getSnapshot()
  assert.equal(again.find((item) => item.id === 'scamsniffer')?.entries.length, 2)
  assert.equal(again.find((item) => item.id === 'safe')?.enabled, false)
})

test('the store: settled waits for the fetches that run now', async () => {
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  const fetch: Fetch = async () => {
    await held
    return new Response(JSON.stringify(scamSniffer))
  }
  const store = createAddressListStore({ storage: () => throwing, fetch, now: () => 1000 })
  await store.settled()
  void store.refresh('scamsniffer', [1])
  let done = false
  const settled = store.settled().then(() => (done = true))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(done, false)
  release()
  await settled
  assert.equal(store.getSnapshot().find((item) => item.id === 'scamsniffer')?.entries.length, 2)
})
