import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import type { ChainConfig } from '../src/chainList.ts'
import {
  blockscoutContract,
  blockscoutLink,
  blockscoutUrl,
  etherscanLink,
  etherscanSource,
  etherscanUrl,
  EXPLORER_HOSTS,
  explorersOf,
  fetchJson,
  linkable,
  MAX_ANSWER,
  parseBlockscoutContract,
  parseEtherscanAnswer,
  sourcifyLink,
  statusText,
} from '../src/context/explorers.ts'
import type { Fetch } from '../src/gates/gate.ts'
import type { Hex } from '../src/messages.ts'

const USDC: Hex = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678'

const chain = (id: number, fields: Partial<ChainConfig> = {}): ChainConfig => ({
  id,
  name: 'test',
  mode: 'rpc',
  executionRpc: 'https://rpc.example',
  ...fields,
})

// A fake fetch that answers each request with the same status and body,
// and records the URLs.
function answering(status: number, body: unknown): Fetch & { calls: string[] } {
  const calls: string[] = []
  const fetch = async (url: string) => {
    calls.push(url)
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    return new Response(text, { status })
  }
  return Object.assign(fetch, { calls })
}

function failing(error: Error): Fetch & { calls: string[] } {
  const calls: string[] = []
  const fetch = async (url: string) => {
    calls.push(url)
    throw error
  }
  return Object.assign(fetch, { calls })
}

// Trimmed real answers of Etherscan API V2, checked on 2026-10-27.
const ETHERSCAN_VERIFIED = {
  status: '1',
  message: 'OK',
  result: [{ SourceCode: 'pragma solidity ^0.4.24;', ABI: '[]', ContractName: 'FiatTokenProxy', Proxy: '1' }],
}
const ETHERSCAN_NOT_VERIFIED = {
  status: '1',
  message: 'OK',
  result: [{ SourceCode: '', ABI: 'Contract source code not verified', ContractName: '' }],
}
const etherscanError = (result: string) => ({ status: '0', message: 'NOTOK', result })

// Trimmed real answers of eth.blockscout.com, checked on 2026-10-27.
const BLOCKSCOUT_VERIFIED = {
  is_verified: true,
  is_partially_verified: true,
  is_fully_verified: false,
  is_verified_via_sourcify: false,
  name: 'FiatTokenProxy',
  language: 'solidity',
  compiler_version: 'v0.4.24+commit.e67f0147',
}
const BLOCKSCOUT_NO_SOURCES = {
  conflicting_implementations: null,
  creation_bytecode: '0x5860208158601c335a63aaf10f428752fa158151803b80938091923cf3',
  creation_status: 'success',
  deployed_bytecode: '0x3460ff164360ff1614',
  implementations: [],
  proxy_type: null,
}

test('the links of each explorer and of Sourcify', () => {
  assert.equal(etherscanLink('https://etherscan.io', USDC), `https://etherscan.io/address/${USDC}#code`)
  assert.equal(
    blockscoutLink('https://eth.blockscout.com', USDC),
    `https://eth.blockscout.com/address/${USDC}?tab=contract`,
  )
  assert.equal(sourcifyLink(1, USDC), `https://repo.sourcify.dev/1/${USDC}`)
  assert.equal(
    etherscanUrl(1, USDC, KEY),
    `https://api.etherscan.io/v2/api?chainid=1&module=contract&action=getsourcecode&address=${USDC}&apikey=${KEY}`,
  )
  assert.equal(
    blockscoutUrl('https://eth.blockscout.com/', USDC),
    `https://eth.blockscout.com/api/v2/smart-contracts/${USDC}`,
  )
})

test('explorersOf takes the table, and the fields of the chain win', () => {
  assert.deepEqual(explorersOf(chain(1)), {
    etherscan: 'https://etherscan.io',
    blockscout: 'https://eth.blockscout.com',
    blockscoutApi: 'https://eth.blockscout.com',
  })
  assert.deepEqual(explorersOf(chain(59144)), {
    etherscan: 'https://lineascan.build',
    blockscout: 'https://explorer.linea.build',
    blockscoutApi: 'https://api-explorer.linea.build',
  })
  // An own instance serves its API on its own host, unless the chain names another.
  assert.deepEqual(explorersOf(chain(1, { blockscout: 'https://scout.example/' })), {
    etherscan: 'https://etherscan.io',
    blockscout: 'https://scout.example',
    blockscoutApi: 'https://scout.example',
  })
  assert.deepEqual(
    explorersOf(chain(1, { blockscout: 'https://scout.example', blockscoutApi: 'https://api.scout.example' })),
    {
      etherscan: 'https://etherscan.io',
      blockscout: 'https://scout.example',
      blockscoutApi: 'https://api.scout.example',
    },
  )
  // An empty field turns the explorer off.
  assert.deepEqual(explorersOf(chain(1, { etherscan: '', blockscout: '' })), {
    etherscan: null,
    blockscout: null,
    blockscoutApi: null,
  })
  // A custom chain that the table does not know has no explorer.
  assert.deepEqual(explorersOf(chain(777, { custom: true })), {
    etherscan: null,
    blockscout: null,
    blockscoutApi: null,
  })
})

test('linkable allows the built-in hosts and Sourcify only', () => {
  assert.ok(linkable(etherscanLink('https://basescan.org', USDC)))
  assert.ok(linkable(sourcifyLink(8453, USDC)))
  assert.ok(!linkable(blockscoutLink('https://scout.example', USDC)))
  assert.ok(!linkable('https://etherscan.io.evil.com/address/x'))
})

test('each link host is in the allowlist of open_url in Rust', () => {
  const rust = readFileSync(new URL('../src-tauri/src/browser.rs', import.meta.url), 'utf8')
  const allowed = [...rust.matchAll(/"(https:\/\/[^"]+\/)"/g)].map((match) => match[1])
  const hosts = Object.values(EXPLORER_HOSTS).flatMap((hosts) => [hosts.etherscan, hosts.blockscout])
  for (const host of [...hosts, 'https://repo.sourcify.dev']) assert.ok(allowed.includes(`${host}/`), host)
})

test('parseEtherscanAnswer reads verified and not verified', () => {
  assert.deepEqual(parseEtherscanAnswer(ETHERSCAN_VERIFIED), {
    kind: 'verified',
    name: 'FiatTokenProxy',
    partial: false,
  })
  assert.deepEqual(parseEtherscanAnswer(ETHERSCAN_NOT_VERIFIED), { kind: 'not verified' })
})

test('parseEtherscanAnswer gives unknown for each error, never not verified', () => {
  assert.deepEqual(parseEtherscanAnswer(etherscanError('Missing/Invalid API Key')), {
    kind: 'unknown',
    reason: 'the API key is missing or not valid',
  })
  assert.deepEqual(parseEtherscanAnswer(etherscanError('Invalid API Key (#err2)|x')), {
    kind: 'unknown',
    reason: 'the API key is missing or not valid',
  })
  assert.deepEqual(
    parseEtherscanAnswer(etherscanError('Max rate limit reached, please use API Key for higher rate limit')),
    {
      kind: 'unknown',
      reason: 'rate limited',
      limited: true,
    },
  )
  assert.deepEqual(
    parseEtherscanAnswer(
      etherscanError(
        'Free API access is not supported for this chain. Please upgrade your api plan for full chain coverage. https://etherscan.io/apis',
      ),
    ),
    { kind: 'unknown', reason: 'this chain needs a paid plan' },
  )
  assert.deepEqual(parseEtherscanAnswer(etherscanError('Something else')), {
    kind: 'unknown',
    reason: 'Something else',
  })
  // Shapes that do not read.
  for (const body of [
    null,
    [],
    'text',
    { status: '1', result: [] },
    { status: '1', result: [{ ABI: '[]' }] },
    { status: '0', result: [{ SourceCode: '' }] },
    { status: '1', result: [{ SourceCode: '', ABI: '[]' }] },
  ]) {
    assert.equal(parseEtherscanAnswer(body).kind, 'unknown', JSON.stringify(body))
  }
})

test('parseBlockscoutContract reads verified, partial, and no sources', () => {
  assert.deepEqual(parseBlockscoutContract(BLOCKSCOUT_VERIFIED), {
    kind: 'verified',
    name: 'FiatTokenProxy',
    partial: true,
  })
  assert.deepEqual(parseBlockscoutContract({ ...BLOCKSCOUT_VERIFIED, is_fully_verified: true }), {
    kind: 'verified',
    name: 'FiatTokenProxy',
    partial: false,
  })
  assert.deepEqual(parseBlockscoutContract(BLOCKSCOUT_NO_SOURCES), { kind: 'not verified' })
  assert.deepEqual(parseBlockscoutContract({ is_verified: false }), { kind: 'not verified' })
  for (const body of [null, [], 'text', {}, { is_verified: 'yes' }]) {
    assert.equal(parseBlockscoutContract(body).kind, 'unknown', JSON.stringify(body))
  }
})

test('etherscanSource without a key sends no request', async () => {
  const fetch = answering(200, ETHERSCAN_VERIFIED)
  assert.deepEqual(await etherscanSource(1, USDC, '', fetch), { kind: 'no key' })
  assert.deepEqual(await etherscanSource(1, USDC, '  ', fetch), { kind: 'no key' })
  assert.deepEqual(fetch.calls, [])
})

test('etherscanSource with a key asks the API V2 with the chain id', async () => {
  const fetch = answering(200, ETHERSCAN_VERIFIED)
  assert.equal((await etherscanSource(8453, USDC, KEY, fetch)).kind, 'verified')
  assert.deepEqual(fetch.calls, [etherscanUrl(8453, USDC, KEY)])
  assert.deepEqual(await etherscanSource(1, USDC, KEY, answering(200, ETHERSCAN_NOT_VERIFIED)), {
    kind: 'not verified',
  })
})

test('etherscanSource gives unknown for each failure of the transport', async () => {
  assert.deepEqual(await etherscanSource(1, USDC, KEY, answering(429, {})), {
    kind: 'unknown',
    reason: 'rate limited',
    limited: true,
  })
  assert.deepEqual(await etherscanSource(1, USDC, KEY, answering(502, '<html>bad gateway</html>')), {
    kind: 'unknown',
    reason: 'HTTP 502',
  })
  assert.deepEqual(await etherscanSource(1, USDC, KEY, answering(200, '<html>')), {
    kind: 'unknown',
    reason: 'an answer that is not JSON',
  })
  assert.deepEqual(await etherscanSource(1, USDC, KEY, failing(new TypeError('Load failed'))), {
    kind: 'unknown',
    reason: 'network error · Load failed',
  })
  const timeout = new DOMException('The operation timed out.', 'TimeoutError')
  assert.deepEqual(await etherscanSource(1, USDC, KEY, failing(timeout)), {
    kind: 'unknown',
    reason: 'no answer in time',
  })
})

test('fetchJson reads at most MAX_ANSWER bytes of a body', async () => {
  const big: Fetch = async () => new Response(`"${'a'.repeat(MAX_ANSWER)}"`)
  assert.deepEqual(await fetchJson('https://eth.blockscout.com/api', big), {
    ok: false,
    reason: 'the answer is over 2 MB',
  })
  const small: Fetch = async () => new Response('{"a":1}', { status: 200 })
  assert.deepEqual(await fetchJson('https://eth.blockscout.com/api', small), { ok: true, status: 200, body: { a: 1 } })
})

test('blockscoutContract asks the API host and reads the status', async () => {
  const fetch = answering(200, BLOCKSCOUT_VERIFIED)
  assert.equal((await blockscoutContract('https://api.scout.example', USDC, fetch)).kind, 'verified')
  assert.deepEqual(fetch.calls, [`https://api.scout.example/api/v2/smart-contracts/${USDC}`])
  // No code at the address, checked on 2026-10-27.
  assert.deepEqual(await blockscoutContract('https://x.example', USDC, answering(404, { message: 'Not found' })), {
    kind: 'not verified',
  })
  assert.deepEqual(await blockscoutContract('https://x.example', USDC, answering(200, BLOCKSCOUT_NO_SOURCES)), {
    kind: 'not verified',
  })
})

test('blockscoutContract gives unknown for each failure', async () => {
  const api = 'https://x.example'
  assert.deepEqual(await blockscoutContract(api, USDC, answering(429, {})), {
    kind: 'unknown',
    reason: 'rate limited',
    limited: true,
  })
  assert.deepEqual(await blockscoutContract(api, USDC, answering(403, '<html>bot check</html>')), {
    kind: 'unknown',
    reason: 'the instance refused the request',
  })
  assert.deepEqual(await blockscoutContract(api, USDC, answering(500, {})), { kind: 'unknown', reason: 'HTTP 500' })
  // Only the 404 of Blockscout itself means not verified.
  assert.deepEqual(await blockscoutContract(api, USDC, answering(404, '<html>Not Found</html>')), {
    kind: 'unknown',
    reason: 'HTTP 404',
  })
  assert.deepEqual(await blockscoutContract(api, USDC, answering(404, { message: 'Page not found' })), {
    kind: 'unknown',
    reason: 'HTTP 404',
  })
  assert.deepEqual(await blockscoutContract(api, USDC, answering(200, 'not json')), {
    kind: 'unknown',
    reason: 'an answer that is not JSON',
  })
  assert.deepEqual(await blockscoutContract(api, USDC, failing(new TypeError('Load failed'))), {
    kind: 'unknown',
    reason: 'network error · Load failed',
  })
  const timeout = new DOMException('The operation timed out.', 'TimeoutError')
  assert.deepEqual(await blockscoutContract(api, USDC, failing(timeout)), {
    kind: 'unknown',
    reason: 'no answer in time',
  })
})

test('statusText says each status in words', () => {
  assert.equal(statusText({ kind: 'verified', name: 'A', partial: true }), 'verified · A · partial match')
  assert.equal(statusText({ kind: 'verified', name: null, partial: false }), 'verified')
  assert.equal(statusText({ kind: 'not verified' }), 'not verified')
  assert.equal(statusText({ kind: 'unknown', reason: 'HTTP 500' }), 'unknown · HTTP 500')
  assert.equal(statusText({ kind: 'no key' }), 'no API key · not asked')
})
