// The Sourcify gate with the real compiler and the real lib-sourcify: a
// fake would hide a difference in how they take the sources and the code.
// The compiler build is downloaded once into test/.cache.

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'

import type { Hex } from '../src/messages.ts'
import type { Creation, CreationReader } from '../src/gates/creation.ts'
import type { Fetch, LogLine } from '../src/gates/gate.ts'
import { solcFor } from '../src/gates/solc.ts'
import { lookupUrl, sourcifyGateFor } from '../src/gates/sourcify.ts'

const CACHE = new URL('./.cache/', import.meta.url)
const VERSION = '0.8.24+commit.e11b9ed9'
const ADDRESS: Hex = '0x1111111111111111111111111111111111111111'
const TX_HASH: Hex = '0xe7e0fe390354509cd08c9a0168536938600ddc552b3f7cb96030ebef62e75895'
const DEPLOYMENT = { transactionHash: TX_HASH, blockNumber: '6083505', transactionIndex: '42', deployer: ADDRESS }
// The gate keeps a result for each address in the session, so each test
// with a creation transaction has its own address.
const DEPLOYED: Hex[] = [
  '0x3333333333333333333333333333333333333333',
  '0x4444444444444444444444444444444444444444',
  '0x5555555555555555555555555555555555555555',
  '0x6666666666666666666666666666666666666666',
  '0x7777777777777777777777777777777777777777',
]
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

// Sourcify, answering for one address only. With a deployment, or without.
function sourcify(found: boolean, deployment: typeof DEPLOYMENT | null = null, address = ADDRESS): Fetch {
  return async (url) => {
    if (url !== lookupUrl(1, address)) return new Response('not found', { status: 404 })
    if (!found) return Response.json({ match: null, chainId: '1', address }, { status: 404 })
    return Response.json({
      match: 'exact_match',
      creationMatch: deployment ? 'exact_match' : null,
      runtimeMatch: 'exact_match',
      chainId: '1',
      address,
      compilation: { language: 'Solidity', compilerVersion: VERSION, fullyQualifiedName: 'src/Counter.sol:Counter' },
      deployment,
      stdJsonInput: STD_JSON_INPUT,
    })
  }
}

// The chain gate, with the creation transaction that it read.
function chainWith(input: Hex, verified = true): CreationReader {
  return async (address, transactionHash) => {
    const creation: Creation = {
      transactionHash,
      blockNumber: 6083505,
      transactionIndex: 42,
      deployer: address,
      input,
      verified,
    }
    return { creation }
  }
}

// The chain gate that did not read it: a factory, or an endpoint that
// did not answer.
const factory: CreationReader = async () => ({ creation: null, reason: 'created by another contract', retry: false })
const noAnswer: CreationReader = async () => ({ creation: null, reason: 'HTTP 429', retry: true })

function collect() {
  const lines: LogLine[] = []
  return { lines, log: (line: LogLine) => lines.push(line) }
}

// The code that the chain would have: the runtime bytecode of the same
// compile, as a deployment would leave it. And the creation bytecode, the
// input of the transaction that deploys it (Counter has no constructor
// arguments).
async function compiled(): Promise<{ code: Hex; creation: Hex }> {
  const selection = ['evm.deployedBytecode.object', 'evm.bytecode.object']
  const settings = { ...STD_JSON_INPUT.settings, outputSelection: { '*': { '*': selection } } }
  const output = (await solc.compile(VERSION, { ...STD_JSON_INPUT, settings }, () => {})) as {
    contracts: Record<
      string,
      Record<string, { evm: { deployedBytecode: { object: string }; bytecode: { object: string } } }>
    >
  }
  const { evm } = output.contracts['src/Counter.sol'].Counter
  return { code: `0x${evm.deployedBytecode.object}`, creation: `0x${evm.bytecode.object}` }
}

const deployedCode = async () => (await compiled()).code

// Changes one byte of the code, at a position from the end.
function changed(code: Hex, fromEnd: number): Hex {
  const at = code.length - fromEnd * 2
  const byte = code.slice(at, at + 2) === '00' ? '01' : '00'
  return `${code.slice(0, at)}${byte}${code.slice(at + 2)}` as Hex
}

test('the sources compile to the code on chain: exact match, with the ABI of the compile', async () => {
  const code = await deployedCode()
  const { lines, log } = collect()
  const verified = await sourcifyGateFor(1, sourcify(true), solc, factory).run({ address: ADDRESS, code }, log)
  assert.equal(verified.runtimeMatch, 'perfect')
  assert.equal(verified.creationMatch, null)
  assert.equal(verified.creationNote, 'Sourcify does not know the creation transaction')
  assert.equal(verified.claim.name, 'Counter')
  assert.deepEqual(verified.transformations.runtime, { list: [], values: {} })
  const names = (verified.abi as { name?: string }[]).map((entry) => entry.name).sort()
  assert.deepEqual(names, ['count', 'up'])
  const texts = lines.map((line) => line.text)
  assert.ok(texts.includes(`compiling Counter · ${VERSION}`))
  assert.deepEqual(lines.at(-1), {
    source: 'sourcify',
    text: 'runtime bytecode compare · exact match',
    ok: true,
    proof: true,
  })
})

test('another metadata hash on chain: a match, with the auxdata transformation', async () => {
  // The CBOR auxdata is at the end of the code, before its two length bytes.
  const code = changed(await deployedCode(), 10)
  const { log } = collect()
  const verified = await sourcifyGateFor(1, sourcify(true), solc, factory).run({ address: ADDRESS, code }, log)
  assert.equal(verified.runtimeMatch, 'partial')
  assert.equal(verified.transformations.runtime.list[0]?.reason, 'cborAuxdata')
})

test('other code on chain: the gate fails', async () => {
  const code = changed(await deployedCode(), 80)
  const { log } = collect()
  await assert.rejects(sourcifyGateFor(1, sourcify(true), solc, factory).run({ address: ADDRESS, code }, log), /match/)
})

test('no sources on Sourcify: the gate fails before compiling', async () => {
  const { lines, log } = collect()
  const gate = sourcifyGateFor(1, sourcify(false), solc, factory)
  await assert.rejects(
    gate.run({ address: ADDRESS, code: '0x6000' }, log),
    /not verified on Sourcify · nothing to compile/,
  )
  assert.ok(lines.every((line) => line.source === 'sourcify'))
})

test('the creation transaction read: its input is the creation bytecode, exact match', async () => {
  const { code, creation } = await compiled()
  const { lines, log } = collect()
  const gate = sourcifyGateFor(1, sourcify(true, DEPLOYMENT, DEPLOYED[0]), solc, chainWith(creation))
  const verified = await gate.run({ address: DEPLOYED[0], code }, log)
  assert.equal(verified.runtimeMatch, 'perfect')
  assert.equal(verified.creationMatch, 'perfect')
  assert.equal(verified.creationNote, null)
  assert.deepEqual(lines.at(-1), {
    source: 'sourcify',
    text: 'creation bytecode compare · exact match',
    ok: true,
    proof: true,
  })
})

test('the creation transaction read, with another input: the runtime still matches', async () => {
  const { code, creation } = await compiled()
  const { lines, log } = collect()
  const gate = sourcifyGateFor(1, sourcify(true, DEPLOYMENT, DEPLOYED[1]), solc, chainWith(changed(creation, 80)))
  const verified = await gate.run({ address: DEPLOYED[1], code }, log)
  assert.equal(verified.runtimeMatch, 'perfect')
  assert.equal(verified.creationMatch, null)
  assert.match(verified.creationNote ?? '', /not the recompiled creation bytecode/)
  assert.match(lines.at(-1)?.text ?? '', /^creation bytecode compare · no match/)
})

test('the creation transaction read without proof: a match, with a note', async () => {
  const { code, creation } = await compiled()
  const { log } = collect()
  const gate = sourcifyGateFor(1, sourcify(true, DEPLOYMENT, DEPLOYED[3]), solc, chainWith(creation, false))
  const verified = await gate.run({ address: DEPLOYED[3], code }, log)
  assert.equal(verified.creationMatch, 'perfect')
  assert.equal(verified.creationNote, 'the transaction was read without proof')
})

test('the creation transaction not read: the runtime match passes, with the reason', async () => {
  const { code } = await compiled()
  const { log } = collect()
  const gate = sourcifyGateFor(1, sourcify(true, DEPLOYMENT, DEPLOYED[2]), solc, factory)
  const verified = await gate.run({ address: DEPLOYED[2], code }, log)
  assert.equal(verified.runtimeMatch, 'perfect')
  assert.equal(verified.creationMatch, null)
  assert.equal(verified.creationNote, 'created by another contract')
})

test('the creation transaction read failed on the way: the next request reads again', async () => {
  const { code, creation } = await compiled()
  const first = collect()
  const address = DEPLOYED[4]
  const failed = await sourcifyGateFor(1, sourcify(true, DEPLOYMENT, address), solc, noAnswer).run(
    { address, code },
    first.log,
  )
  assert.equal(failed.creationNote, 'HTTP 429')
  const second = collect()
  const again = await sourcifyGateFor(1, sourcify(true, DEPLOYMENT, address), solc, chainWith(creation)).run(
    { address, code },
    second.log,
  )
  assert.equal(again.creationMatch, 'perfect')
  assert.ok(!second.lines.some((line) => /verified before in this session/.test(line.text)))
})

test('the same code again: from the session, without a compile', async () => {
  const code = await deployedCode()
  const { lines, log } = collect()
  const verified = await sourcifyGateFor(1, sourcify(false), solc, factory).run({ address: ADDRESS, code }, log)
  assert.equal(verified.runtimeMatch, 'perfect')
  assert.deepEqual(
    lines.map((line) => line.text),
    [`${ADDRESS} · same code verified before in this session`],
  )
})
