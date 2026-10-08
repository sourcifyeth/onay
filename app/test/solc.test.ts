import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import type { Fetch, LogLine } from '../src/gates/gate.ts'
import { parseList, pickBuild, sha256, SOLC_BIN, solcFor, type Build } from '../src/gates/solc.ts'

const SOLJSON = 'var Module = { compile: function () { return "{}" } };'
const HASH = `0x${createHash('sha256').update(SOLJSON).digest('hex')}`

// The list of binaries.soliditylang.org/emscripten-wasm32, cut to two
// builds. The first has the hash of the fake soljson above.
const LIST = {
  builds: [
    {
      path: 'solc-emscripten-wasm32-v0.8.24+commit.e11b9ed9.js',
      version: '0.8.24',
      build: 'commit.e11b9ed9',
      longVersion: '0.8.24+commit.e11b9ed9',
      keccak256: '0x1b6ceeabad21bbb2011ba13373160f7c4d46c11371a354243ee1be07159345f3',
      sha256: HASH.toUpperCase().replace('0X', '0x'),
      urls: ['dweb:/ipfs/QmW2SQbEhiz3n2qV5iL8WBgzapv6cXjkLStvTMpCZhvr2x'],
    },
    {
      path: 'solc-emscripten-wasm32-v0.8.25+commit.b61c2a91.js',
      version: '0.8.25',
      build: 'commit.b61c2a91',
      longVersion: '0.8.25+commit.b61c2a91',
      keccak256: '0x4639103a26b2f669bd3ecc22b1a1665819f2a2956f917ab91380bd9565dbcd01',
      sha256: '0xf8c9554471ff2db3843167dffb7a503293b5dc728c8305b044ef9fd37d626ca7',
      urls: ['dweb:/ipfs/QmdduJxmPXungjJk2FBDw1bdDQ6ucHxYGLXRMBJqMFW7h9'],
    },
  ],
  releases: {
    '0.8.25': 'solc-emscripten-wasm32-v0.8.25+commit.b61c2a91.js',
    '0.8.24': 'solc-emscripten-wasm32-v0.8.24+commit.e11b9ed9.js',
  },
  latestRelease: '0.8.25',
}

// A fake solc-bin: the list and one soljson.
function server(soljson = SOLJSON): Fetch & { calls: string[] } {
  const calls: string[] = []
  const fetch = async (url: string) => {
    calls.push(url)
    if (url === `${SOLC_BIN}/list.json`) return Response.json(LIST)
    if (url === `${SOLC_BIN}/${LIST.builds[0].path}`) return new Response(soljson)
    return new Response('not found', { status: 404 })
  }
  return Object.assign(fetch, { calls })
}

function collect() {
  const lines: LogLine[] = []
  return { lines, log: (line: LogLine) => lines.push(line) }
}

test('parseList keeps the fields that the download needs, with the hash in lower case', () => {
  const builds = parseList(LIST)
  assert.deepEqual(builds[0], { path: LIST.builds[0].path, longVersion: '0.8.24+commit.e11b9ed9', sha256: HASH })
  assert.throws(() => parseList({}), /unexpected shape/)
  assert.throws(() => parseList({ builds: [{ path: 'x' }] }), /unexpected build/)
})

test('pickBuild takes the exact long version, with or without a v', () => {
  const builds: Build[] = parseList(LIST)
  assert.equal(pickBuild(builds, '0.8.24+commit.e11b9ed9')?.path, LIST.builds[0].path)
  assert.equal(pickBuild(builds, 'v0.8.24+commit.e11b9ed9')?.path, LIST.builds[0].path)
  assert.equal(pickBuild(builds, '0.8.24'), null)
  assert.equal(pickBuild(builds, '0.8.24+commit.00000000'), null)
})

test('sha256 gives the digest as a hex string with 0x', async () => {
  assert.equal(await sha256(new TextEncoder().encode(SOLJSON)), HASH)
})

test('soljson: the list once, the build once, the hash checked, the log says so', async () => {
  const fetch = server()
  const solc = solcFor(fetch)
  const { lines, log } = collect()
  assert.equal(await solc.soljson('0.8.24+commit.e11b9ed9', log), SOLJSON)
  assert.equal(await solc.soljson('0.8.24+commit.e11b9ed9', log), SOLJSON)
  assert.deepEqual(fetch.calls, [`${SOLC_BIN}/list.json`, `${SOLC_BIN}/${LIST.builds[0].path}`])
  assert.deepEqual(
    lines.map(({ text, ok }) => [text, ok]),
    [
      ['downloading solc-emscripten-wasm32-v0.8.24+commit.e11b9ed9.js', undefined],
      ['0.8.24+commit.e11b9ed9 · downloaded · sha256 matches the official list', true],
    ],
  )
  assert.ok(lines.every((line) => line.source === 'solc'))
})

test('soljson: a file with another hash is refused, and the next call tries again', async () => {
  const fetch = server('var Module = {}; // not the file in the list')
  const solc = solcFor(fetch)
  const { log } = collect()
  await assert.rejects(solc.soljson('0.8.24+commit.e11b9ed9', log), /does not match the hash in the official list/)
  await assert.rejects(solc.soljson('0.8.24+commit.e11b9ed9', log), /does not match/)
  assert.equal(fetch.calls.filter((url) => url.endsWith('.js')).length, 2)
})

test('soljson: a version that is not in the list', async () => {
  const { log } = collect()
  await assert.rejects(solcFor(server()).soljson('0.8.99+commit.12345678', log), /not in the official list/)
})
