// The Sourcify gate with the real compiler and the real lib-sourcify: a
// fake would hide a difference in how they take the sources and the code.
// The compiler build is downloaded once into test/.cache.

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'

import type { Hex } from '../src/messages.ts'
import type { Fetch, LogLine } from '../src/gates/gate.ts'
import { solcFor } from '../src/gates/solc.ts'
import { lookupUrl, sourcifyGateFor } from '../src/gates/sourcify.ts'

const CACHE = new URL('./.cache/', import.meta.url)
const VERSION = '0.8.24+commit.e11b9ed9'
const ADDRESS: Hex = '0x1111111111111111111111111111111111111111'
const CONTRACT =
  'pragma solidity 0.8.24;\ncontract Counter {\n  uint public count;\n  function up() external { count++; }\n}\n'
const STD_JSON_INPUT = {
  language: 'Solidity',
  sources: { 'src/Counter.sol': { content: CONTRACT } },
  settings: { optimizer: { enabled: false, runs: 200 }, evmVersion: 'shanghai' },
}

// binaries.soliditylang.org, through a file cache.
const cachedFetch: Fetch = async (url, init) => {
  mkdirSync(CACHE, { recursive: true })
  const file = new URL(url.slice(url.lastIndexOf('/') + 1), CACHE)
  try {
    return new Response(readFileSync(file))
  } catch {
    const response = await fetch(url, init)
    if (response.ok) writeFileSync(file, new Uint8Array(await response.clone().arrayBuffer()))
    return response
  }
}

const solc = solcFor(cachedFetch)

// Sourcify, answering for ADDRESS only.
function sourcify(found: boolean): Fetch {
  return async (url) => {
    if (url !== lookupUrl(1, ADDRESS)) return new Response('not found', { status: 404 })
    if (!found) return Response.json({ match: null, chainId: '1', address: ADDRESS }, { status: 404 })
    return Response.json({
      match: 'exact_match',
      creationMatch: null,
      runtimeMatch: 'exact_match',
      chainId: '1',
      address: ADDRESS,
      compilation: { language: 'Solidity', compilerVersion: VERSION, fullyQualifiedName: 'src/Counter.sol:Counter' },
      deployment: null,
      stdJsonInput: STD_JSON_INPUT,
    })
  }
}

function collect() {
  const lines: LogLine[] = []
  return { lines, log: (line: LogLine) => lines.push(line) }
}

// The code that the chain would have: the runtime bytecode of the same
// compile, as a deployment would leave it.
async function deployedCode(): Promise<Hex> {
  const settings = { ...STD_JSON_INPUT.settings, outputSelection: { '*': { '*': ['evm.deployedBytecode.object'] } } }
  const output = (await solc.compile(VERSION, { ...STD_JSON_INPUT, settings }, () => {})) as {
    contracts: Record<string, Record<string, { evm: { deployedBytecode: { object: string } } }>>
  }
  return `0x${output.contracts['src/Counter.sol'].Counter.evm.deployedBytecode.object}`
}

// Changes one byte of the code, at a position from the end.
function changed(code: Hex, fromEnd: number): Hex {
  const at = code.length - fromEnd * 2
  const byte = code.slice(at, at + 2) === '00' ? '01' : '00'
  return `${code.slice(0, at)}${byte}${code.slice(at + 2)}` as Hex
}

test('the sources compile to the code on chain: exact match, with the ABI of the compile', async () => {
  const code = await deployedCode()
  const { lines, log } = collect()
  const verified = await sourcifyGateFor(1, sourcify(true), solc).run({ address: ADDRESS, code }, log)
  assert.equal(verified.runtimeMatch, 'perfect')
  assert.equal(verified.creationMatch, null)
  assert.equal(verified.claim.name, 'Counter')
  assert.deepEqual(verified.transformations.runtime, { list: [], values: {} })
  const names = (verified.abi as { name?: string }[]).map((entry) => entry.name).sort()
  assert.deepEqual(names, ['count', 'up'])
  const texts = lines.map((line) => line.text)
  assert.ok(texts.includes(`compiling Counter · ${VERSION}`))
  assert.deepEqual(lines.at(-1), { source: 'sourcify', text: 'runtime bytecode compare · exact match', ok: true })
})

test('another metadata hash on chain: a match, with the auxdata transformation', async () => {
  // The CBOR auxdata is at the end of the code, before its two length bytes.
  const code = changed(await deployedCode(), 10)
  const { log } = collect()
  const verified = await sourcifyGateFor(1, sourcify(true), solc).run({ address: ADDRESS, code }, log)
  assert.equal(verified.runtimeMatch, 'partial')
  assert.equal(verified.transformations.runtime.list[0]?.reason, 'cborAuxdata')
})

test('other code on chain: the gate fails', async () => {
  const code = changed(await deployedCode(), 80)
  const { log } = collect()
  await assert.rejects(sourcifyGateFor(1, sourcify(true), solc).run({ address: ADDRESS, code }, log), /match/)
})

test('no sources on Sourcify: the gate fails before compiling', async () => {
  const { lines, log } = collect()
  const gate = sourcifyGateFor(1, sourcify(false), solc)
  await assert.rejects(
    gate.run({ address: ADDRESS, code: '0x6000' }, log),
    /not verified on Sourcify · nothing to compile/,
  )
  assert.ok(lines.every((line) => line.source === 'sourcify'))
})

test('the same code again: from the session, without a compile', async () => {
  const code = await deployedCode()
  const { lines, log } = collect()
  const verified = await sourcifyGateFor(1, sourcify(false), solc).run({ address: ADDRESS, code }, log)
  assert.equal(verified.runtimeMatch, 'perfect')
  assert.deepEqual(
    lines.map((line) => line.text),
    [`${ADDRESS} · same code verified before in this session`],
  )
})
