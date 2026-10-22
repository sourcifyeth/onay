// The simulation with the real EVM on a fake chain: three contracts that
// call each other, compiled by the real compiler.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ChainConfig } from '../src/chains.ts'
import type { Hex } from '../src/messages.ts'
import type { LogLine } from '../src/gates/gate.ts'
import type { ChainRead } from '../src/gates/helios.ts'
import type { Call } from '../src/gates/request.ts'
import { describe, reverted, simulationGateFor, type Frame } from '../src/gates/simulation.ts'
import { compile } from './solc.ts'

const SENDER: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const CALLER: Hex = '0x1111111111111111111111111111111111111111'
const CALLEE: Hex = '0x2222222222222222222222222222222222222222'
const IMPL: Hex = '0x3333333333333333333333333333333333333333'
const PAYEE: Hex = '0x4444444444444444444444444444444444444444'
// An EIP-7702 account that delegates to IMPL.
const DELEGATED: Hex = '0x5555555555555555555555555555555555555555'

const SOURCE = `
pragma solidity 0.8.24;
contract Callee {
  uint public n;
  function bump() external { n++; }
  function fail() external pure { revert("nope"); }
}
contract Impl {
  uint public n;
  // Payable: a delegatecall keeps the value of the call that made it.
  function set(uint v) external payable { n = v; }
}
contract Caller {
  uint public n;
  function run() external payable {
    Callee(${CALLEE}).bump();
    (bool ok, ) = address(${IMPL}).delegatecall(abi.encodeWithSignature("set(uint256)", 7));
    require(ok);
    Callee(${CALLEE}).n();
    payable(${PAYEE}).transfer(1 wei);
  }
  function bad() external { Callee(${CALLEE}).fail(); }
  function make() external { new Callee(); }
  function makeTwice() external { new Callee{salt: 0}(); new Callee{salt: 0}(); }
  function hash() external view returns (bytes32) { return sha256(abi.encodePacked(block.number)); }
}
`

const EMPTY_CODE_HASH = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
const EMPTY_ROOT = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421'
const HEADER = {
  number: '0xff',
  timestamp: '0x6900',
  gasLimit: '0x1c9c380',
  baseFeePerGas: '0x3b9aca00',
  miner: '0x9999999999999999999999999999999999999999',
  mixHash: `0x${'ab'.repeat(32)}`,
  excessBlobGas: '0x0',
}

const contracts = compile(SOURCE)

type Fake = ChainRead & { asked: string[] }

// A chain with the compiled contracts at their addresses, one ether for
// the sender, and no account anywhere else. It records each read.
async function chain(): Promise<Fake> {
  const { Caller, Callee, Impl } = await contracts
  const code: Record<string, Hex> = {
    [CALLER]: Caller.runtime,
    [CALLEE]: Callee.runtime,
    [IMPL]: Impl.runtime,
    [DELEGATED]: `0xef0100${IMPL.slice(2)}`,
  }
  const asked: string[] = []
  const read: ChainRead = async (method, params) => {
    asked.push(`${method} ${params[0]}${method === 'eth_getStorageAt' ? ` ${params[1]}` : ''}`)
    const address = String(params[0]).toLowerCase()
    switch (method) {
      case 'eth_getBlockByNumber':
        return params[0] === '0xff' ? HEADER : null
      case 'eth_getProof':
        if (address === SENDER)
          return { nonce: '0x5', balance: '0xde0b6b3a7640000', codeHash: EMPTY_CODE_HASH, storageHash: EMPTY_ROOT }
        if (code[address])
          return { nonce: '0x1', balance: '0x0', codeHash: `0x${'01'.repeat(32)}`, storageHash: EMPTY_ROOT }
        return { nonce: '0x0', balance: '0x0', codeHash: EMPTY_CODE_HASH, storageHash: EMPTY_ROOT }
      case 'eth_getCode':
        return code[address] ?? '0x'
      case 'eth_getStorageAt':
        return `0x${'00'.repeat(32)}`
      default:
        throw new Error(`${method} not expected`)
    }
  }
  return Object.assign(read, { asked })
}

const RPC: ChainConfig = { id: 1, name: 'test', mode: 'rpc', executionRpc: 'http://chain.invalid' }
const HELIOS: ChainConfig = { ...RPC, mode: 'helios' }

async function call(signature: string, value = 0n, to: Hex = CALLER): Promise<Call> {
  const { Caller, Impl } = await contracts
  const selectors = { ...Impl.selectors, ...Caller.selectors }
  return { from: SENDER, to, data: selectors[signature], value, gas: null }
}

function collect() {
  const lines: LogLine[] = []
  return { lines, log: (line: LogLine) => lines.push(line) }
}

const shape = ({ depth, kind, address, context, error }: Frame) => ({ depth, kind, address, context, error })

test('the call tree of a call: each message, and the contracts whose code ran', async () => {
  const read = await chain()
  const { lines, log } = collect()
  const run = await call('run()', 5n)
  const simulation = await simulationGateFor(RPC, read).run({ calls: [run], block: 255 }, log)
  assert.equal(simulation.header.number, 255)
  assert.equal(simulation.calls.length, 1)
  const [result] = simulation.calls
  assert.equal(result.error, null)
  assert.deepEqual(result.frames.map(shape), [
    { depth: 0, kind: 'call', address: CALLER, context: CALLER, error: null },
    { depth: 1, kind: 'call', address: CALLEE, context: CALLEE, error: null },
    { depth: 1, kind: 'delegatecall', address: IMPL, context: CALLER, error: null },
    { depth: 1, kind: 'staticcall', address: CALLEE, context: CALLEE, error: null },
    { depth: 1, kind: 'call', address: PAYEE, context: PAYEE, error: null },
  ])
  assert.equal(result.frames[0].selector, run.data)
  assert.equal(result.frames[0].value, 5n)
  assert.equal(result.frames[4].selector, null)
  assert.equal(result.frames[4].value, 1n)
  assert.deepEqual(
    simulation.touched.map(({ address, contexts }) => [address, contexts]),
    [
      [CALLER, [CALLER]],
      [CALLEE, [CALLEE]],
      [IMPL, [CALLER]],
    ],
  )
  assert.equal(simulation.touched[1].code, (await contracts).Callee.runtime)
  assert.equal(simulation.touched[1].block, 255)
  // bump reads the counter of the callee, set writes the one of the caller.
  assert.ok(read.asked.includes(`eth_getStorageAt ${CALLEE} 0x${'00'.repeat(32)}`))
  assert.ok(read.asked.includes(`eth_getStorageAt ${CALLER} 0x${'00'.repeat(32)}`))
  assert.ok(simulation.reads.accounts >= 4)
  assert.equal(simulation.reads.slots, 2)
  const texts = lines.map((line) => line.text)
  assert.deepEqual(texts.slice(0, 2), [
    'block 255 · header without proof',
    `call ${CALLER} · ${run.data} · <0.000001 ETH`,
  ])
  assert.ok(texts.includes(`  call ${PAYEE} · <0.000001 ETH`))
  assert.ok(texts.includes(`  delegatecall ${IMPL} · ${(await contracts).Impl.selectors['set(uint256)']}`))
  assert.deepEqual(lines.at(-3), { source: 'evm', text: 'executed · 5 messages', ok: true })
  assert.match(lines.at(-2)?.text ?? '', /^state read · \d+ accounts · 2 storage slots · no proof$/)
  assert.deepEqual(lines.at(-1), { source: 'evm', text: 'call tree · 3 contracts', ok: true })
  assert.ok(lines.every((line) => line.source === 'evm'))
})

test('in Helios mode the lines say that the state came with proofs', async () => {
  const { lines, log } = collect()
  await simulationGateFor(HELIOS, await chain()).run({ calls: [await call('run()', 5n)], block: 255 }, log)
  assert.deepEqual(lines[0], { source: 'evm', text: 'block 255 · header verified', ok: true, proof: true })
  assert.equal(lines.at(-2)?.proof, true)
  assert.match(lines.at(-2)?.text ?? '', /merkle proofs verified$/)
})

test('a revert deep in the tree: the reason on the frame, on the call, and in the log', async () => {
  const { lines, log } = collect()
  const simulation = await simulationGateFor(RPC, await chain()).run({ calls: [await call('bad()')], block: 255 }, log)
  const [result] = simulation.calls
  assert.equal(result.error, 'nope')
  assert.equal(reverted(simulation), true)
  assert.deepEqual(result.frames.map(shape), [
    { depth: 0, kind: 'call', address: CALLER, context: CALLER, error: 'nope' },
    { depth: 1, kind: 'staticcall', address: CALLEE, context: CALLEE, error: 'nope' },
  ])
  assert.deepEqual(
    simulation.touched.map(({ address }) => address),
    [CALLER, CALLEE],
  )
  assert.deepEqual(lines.at(-3), { source: 'evm', text: 'reverted · nope', ok: false })
})

test('a contract created on the way is in the tree, not in the contracts to check', async () => {
  const { log } = collect()
  const simulation = await simulationGateFor(RPC, await chain()).run({ calls: [await call('make()')], block: 255 }, log)
  const [result] = simulation.calls
  assert.equal(result.error, null)
  assert.equal(result.frames.length, 2)
  assert.equal(result.frames[1].kind, 'create')
  assert.equal(result.frames[1].depth, 1)
  assert.notEqual(result.frames[1].address, `0x${'0'.repeat(40)}`)
  assert.equal(result.frames[1].context, result.frames[1].address)
  assert.deepEqual(
    simulation.touched.map(({ address }) => address),
    [CALLER],
  )
})

test('a create that fails: the error on its frame, the revert on the call', async () => {
  const { log } = collect()
  const gate = simulationGateFor(RPC, await chain())
  const simulation = await gate.run({ calls: [await call('makeTwice()')], block: 255 }, log)
  const [result] = simulation.calls
  assert.equal(result.error, 'reverted without a reason')
  assert.deepEqual(
    result.frames.map(({ kind, error }) => [kind, error]),
    [
      ['call', 'reverted without a reason'],
      ['create', null],
      ['create', 'create collision'],
    ],
  )
})

test('a precompile of Ethereum is not a frame, and not a contract to check', async () => {
  const { log } = collect()
  const simulation = await simulationGateFor(RPC, await chain()).run({ calls: [await call('hash()')], block: 255 }, log)
  const [result] = simulation.calls
  assert.equal(result.error, null)
  assert.equal(result.frames.length, 1)
})

test('a state read that fails on the way fails the gate, it is not a revert', async () => {
  const real = await chain()
  const broken: ChainRead = (method, params) => {
    if (method === 'eth_getStorageAt') return Promise.reject(new Error('HTTP 429'))
    return real(method, params)
  }
  const { log } = collect()
  await assert.rejects(
    simulationGateFor(RPC, broken).run({ calls: [await call('run()', 5n)], block: 255 }, log),
    /HTTP 429/,
  )
})

test('an EIP-7702 account: its delegate is a contract to check too', async () => {
  const { log } = collect()
  const set = await call('set(uint256)', 0n, DELEGATED)
  set.data = `${set.data}${'00'.repeat(31)}07`
  const simulation = await simulationGateFor(RPC, await chain()).run({ calls: [set], block: 255 }, log)
  assert.equal(simulation.calls[0].error, null)
  assert.deepEqual(
    simulation.touched.map(({ address, contexts }) => [address, contexts]),
    [
      [DELEGATED, [DELEGATED]],
      [IMPL, [DELEGATED]],
    ],
  )
})

test('a batch runs its calls in order on the same state', async () => {
  const read = await chain()
  const { lines, log } = collect()
  const run = await call('run()', 5n)
  const simulation = await simulationGateFor(RPC, read).run({ calls: [run, run], block: 255 }, log)
  assert.equal(simulation.calls.length, 2)
  assert.equal(simulation.calls[1].error, null)
  assert.equal(simulation.calls[1].frames.length, 5)
  // The second call finds the state of the first in the cache.
  assert.equal(simulation.reads.slots, 2)
  assert.deepEqual(
    simulation.touched.map(({ address }) => address),
    [CALLER, CALLEE, IMPL],
  )
  assert.ok(lines.some((line) => line.text === 'call 1 of 2'))
  assert.ok(lines.some((line) => line.text === 'call 2 of 2'))
})

test('a read that hangs past the deadline ends the run', async () => {
  const hanging: ChainRead = () => new Promise(() => {})
  const { log } = collect()
  const gate = simulationGateFor(RPC, hanging, 20)
  await assert.rejects(gate.run({ calls: [await call('run()')], block: 255 }, log), /did not finish in 0.02 s/)
})

test('a block the chain does not know', async () => {
  const { log } = collect()
  const gate = simulationGateFor(RPC, await chain())
  await assert.rejects(gate.run({ calls: [await call('run()')], block: 256 }, log), /unexpected a block/)
})

test('a chain that answers with another block than the one asked for', async () => {
  const real = await chain()
  const stale: ChainRead = (method, params) =>
    method === 'eth_getBlockByNumber' ? Promise.resolve(HEADER) : real(method, params)
  const { log } = collect()
  const gate = simulationGateFor(RPC, stale)
  await assert.rejects(gate.run({ calls: [await call('run()')], block: 254 }, log), /gave block 255, not 254/)
})

test('describe: one frame in words', () => {
  const frame: Frame = {
    depth: 1,
    kind: 'call',
    address: CALLEE,
    context: CALLEE,
    selector: '0x12345678',
    value: 10n ** 18n,
    error: null,
  }
  assert.equal(describe(frame), `call ${CALLEE} · 0x12345678 · 1 ETH`)
  assert.equal(describe({ ...frame, selector: null, value: 0n }), `call ${CALLEE}`)
  assert.equal(describe({ ...frame, kind: 'create', address: `0x${'0'.repeat(40)}`, value: 0n }), 'create · 0x12345678')
})
