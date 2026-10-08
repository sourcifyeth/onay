import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Hex } from '../src/messages.ts'
import type { LogLine } from '../src/gates/gate.ts'
import { sourcifyGateFor, lookupUrl, parseLookup, SOURCIFY_SERVER, type Fetch } from '../src/gates/sourcify.ts'

const ADDRESS: Hex = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

// A trimmed answer of the API v2 for USDC on mainnet.
const FOUND = {
  compilation: { language: 'Solidity', compilerVersion: '0.4.24+commit.e67f0147', name: 'FiatTokenProxy' },
  deployment: {
    transactionHash: '0xe7e0fe390354509cd08c9a0168536938600ddc552b3f7cb96030ebef62e75895',
    blockNumber: '6082465',
    transactionIndex: '22',
    deployer: '0x95Ba4cF87D6723ad9C0Db21737D862bE80e93911',
  },
  stdJsonInput: {
    language: 'Solidity',
    sources: { 'FiatTokenProxy.sol': { content: 'contract FiatTokenProxy {}' }, 'Proxy.sol': { content: '' } },
    settings: { optimizer: { enabled: false, runs: 200 } },
  },
  creationMatch: 'match',
  runtimeMatch: 'match',
  chainId: '1',
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
}

const NOT_FOUND = { match: null, creationMatch: null, runtimeMatch: null, chainId: '1', address: ADDRESS }

function answering(status: number, body: unknown): Fetch & { calls: string[] } {
  const calls: string[] = []
  const fetch = async (url: string) => {
    calls.push(url)
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }
  return Object.assign(fetch, { calls })
}

function collect() {
  const lines: LogLine[] = []
  return { lines, log: (line: LogLine) => lines.push(line) }
}

test('parseLookup takes what the gates need and converts the numbers', () => {
  const lookup = parseLookup(FOUND)
  assert.equal(lookup.found, true)
  assert.equal(lookup.name, 'FiatTokenProxy')
  assert.equal(lookup.compilerVersion, '0.4.24+commit.e67f0147')
  assert.equal(lookup.runtimeMatch, 'match')
  assert.equal(lookup.creationMatch, 'match')
  assert.deepEqual(Object.keys(lookup.stdJsonInput.sources), ['FiatTokenProxy.sol', 'Proxy.sol'])
  assert.deepEqual(lookup.deployment, {
    transactionHash: FOUND.deployment.transactionHash,
    blockNumber: 6082465,
    transactionIndex: 22,
    deployer: FOUND.deployment.deployer,
  })
})

test('parseLookup accepts a missing deployment and missing settings', () => {
  const { deployment: _deployment, ...body } = FOUND
  const stdJsonInput = { language: 'Solidity', sources: {} }
  const lookup = parseLookup({ ...body, deployment: null, stdJsonInput })
  assert.equal(lookup.deployment, null)
  assert.deepEqual(lookup.stdJsonInput.settings, {})
})

test('parseLookup rejects a bad shape and names the field', () => {
  const bad = (change: object) => ({ ...FOUND, ...change })
  assert.throws(() => parseLookup(null), /unexpected the answer/)
  assert.throws(() => parseLookup(bad({ runtimeMatch: 'perfect' })), /unexpected runtimeMatch/)
  assert.throws(() => parseLookup(bad({ compilation: { language: 'Solidity' } })), /compilation.compilerVersion/)
  assert.throws(() => parseLookup(bad({ stdJsonInput: { language: 'Solidity' } })), /stdJsonInput.sources/)
  assert.throws(() => parseLookup(bad({ deployment: { ...FOUND.deployment, blockNumber: 6082465 } })), /blockNumber/)
  assert.throws(() => parseLookup(bad({ deployment: { ...FOUND.deployment, deployer: '0x12' } })), /deployer/)
})

test('lookupUrl asks only for the fields that the gates need', () => {
  const url = new URL(lookupUrl(1, ADDRESS))
  assert.equal(url.origin + url.pathname, `${SOURCIFY_SERVER}/v2/contract/1/${ADDRESS}`)
  assert.deepEqual(url.searchParams.get('fields')?.split(','), [
    'stdJsonInput',
    'compilation.language',
    'compilation.compilerVersion',
    'compilation.name',
    'deployment',
  ])
})

test('the gate: a verified contract, with the claim in the log', async () => {
  const fetch = answering(200, FOUND)
  const { lines, log } = collect()
  const lookup = await sourcifyGateFor(1, fetch).run({ address: ADDRESS }, log)
  assert.equal(lookup.found, true)
  assert.deepEqual(fetch.calls, [lookupUrl(1, ADDRESS)])
  assert.deepEqual(
    lines.map((line) => line.text),
    [
      `looking up ${ADDRESS}`,
      'FiatTokenProxy · Solidity 0.4.24+commit.e67f0147 · 2 files',
      'claims runtime match · creation match · not trusted, reproduced below',
    ],
  )
  assert.ok(lines.every((line) => line.source === 'sourcify' && line.ok === undefined))
})

test('the gate: a contract that is not on Sourcify passes with found false', async () => {
  const { lines, log } = collect()
  const lookup = await sourcifyGateFor(1, answering(404, NOT_FOUND)).run({ address: ADDRESS }, log)
  assert.deepEqual(lookup, { found: false })
  assert.equal(lines[1].text, 'no sources · not verified on Sourcify')
})

test('the gate: other answers and no answer are failures', async () => {
  const { log } = collect()
  await assert.rejects(sourcifyGateFor(1, answering(429, {})).run({ address: ADDRESS }, log), /too many requests/)
  await assert.rejects(sourcifyGateFor(1, answering(500, {})).run({ address: ADDRESS }, log), /HTTP 500/)
  await assert.rejects(sourcifyGateFor(1, answering(200, { nope: true })).run({ address: ADDRESS }, log), /unexpected/)
  const down: Fetch = async () => {
    throw new TypeError('fetch failed')
  }
  await assert.rejects(sourcifyGateFor(1, down).run({ address: ADDRESS }, log), /did not answer: fetch failed/)
})
