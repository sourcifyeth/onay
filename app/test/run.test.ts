// A whole verification with fake gates: how the run ends in each case.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ChainConfig } from '../src/chains.ts'
import type { Hex, SigningRequest } from '../src/messages.ts'
import type { Gate } from '../src/gates/gate.ts'
import { MAX_CONTRACTS } from '../src/gates/contracts.ts'
import type { ChainCode, Head, Target } from '../src/gates/helios.ts'
import type { Call } from '../src/gates/request.ts'
import { startVerification, type Deps, type Verification } from '../src/gates/run.ts'
import type { Simulation, SimulationInput, Touched } from '../src/gates/simulation.ts'
import type { Verified } from '../src/gates/verify.ts'

const FROM: Hex = '0x9f21b45c7e83a10fd4e2c11098d2ce6f4b76c04e'
const A: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const B: Hex = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const C: Hex = '0xcccccccccccccccccccccccccccccccccccccccc'
const CHAIN: ChainConfig = { id: 1, name: 'test', mode: 'helios', executionRpc: 'http://chain.invalid' }
const HEAD: Head = { block: 100, checkpoint: null }

function request(method: string, params: unknown, chainId: number | null = 1): SigningRequest {
  return {
    connection: 1,
    id: '1',
    origin: 'https://dapp.example',
    method,
    params,
    chainId,
    receivedAt: 0,
    outcome: null,
  }
}

const transaction = (to?: Hex) => request('eth_sendTransaction', [{ from: FROM, to, data: '0x12345678' }])

const verified = {
  claim: {} as Verified['claim'],
  runtimeMatch: 'perfect',
  creationMatch: null,
  creationNote: null,
  transformations: { runtime: { list: [], values: {} }, creation: { list: [], values: {} } },
  abi: [],
} satisfies Verified

type Sources = 'verified' | 'not verified' | 'not reproduced' | 'error'

// The chain and Sourcify as tables, and a simulation that touches the
// addresses given. A key in `hold` keeps that gate open until
// `release`.
type World = {
  codes: Partial<Record<Hex, Hex>>
  sources: Partial<Record<Hex, Sources>>
  touched?: Hex[]
  // The contexts of a touched contract. Its own address if not given.
  contexts?: Partial<Record<Hex, Hex[]>>
  revert?: string
  simulationFails?: string
  chainFails?: string
  hold?: string[]
}

function simulationOf(world: World, calls: Call[], block: number): Simulation {
  const touched: Touched[] = (world.touched ?? []).map((address) => ({
    address,
    block,
    code: world.codes[address] ?? '0x',
    contexts: world.contexts?.[address] ?? [address],
  }))
  return {
    header: {
      number: block,
      timestamp: 0,
      gasLimit: 30_000_000n,
      baseFee: null,
      coinbase: A,
      prevRandao: '0x',
      excessBlobGas: null,
    },
    calls: calls.map((call) => ({ call, frames: [], error: world.revert ?? null })),
    touched,
    reads: { accounts: 1, slots: 0 },
  }
}

function setup(world: World) {
  const waits = new Map<string, () => void>()
  const gate = async (key: string) => {
    if (!world.hold?.includes(key)) return
    await new Promise<void>((resolve) => waits.set(key, resolve))
  }
  const heliosCalls: Hex[] = []
  const helios: Gate<Target, ChainCode> = {
    source: 'helios',
    async run({ address, block }) {
      heliosCalls.push(address)
      await gate(`helios:${address}`)
      const code = world.codes[address]
      if (code === undefined) throw new Error('no proof')
      return { address, block, code }
    },
  }
  const sourcify: Gate<{ address: Hex; code: Hex }, Verified> = {
    source: 'sourcify',
    async run({ address }) {
      await gate(`sourcify:${address}`)
      switch (world.sources[address]) {
        case 'verified':
          return verified
        case 'not reproduced':
          throw new Error('not the code on chain', { cause: { kind: 'not reproduced', claim: {} } })
        case 'error':
          throw new Error('Sourcify answered HTTP 500')
        default:
          throw new Error('not verified on Sourcify', { cause: { kind: 'not verified' } })
      }
    },
  }
  const simulation: Gate<SimulationInput, Simulation> = {
    source: 'evm',
    async run({ calls, block }) {
      await gate('simulation')
      if (world.simulationFails) throw new Error(world.simulationFails)
      return simulationOf(world, calls, block)
    },
  }
  const deps: Deps = {
    chainById: (id) => (id === 1 ? CHAIN : undefined),
    async chainReady() {
      if (world.chainFails) throw new Error(world.chainFails)
      return HEAD
    },
    gatesFor: () => ({ helios, sourcify: () => sourcify, simulation }),
    now: () => 0,
  }
  const release = (key: string) => {
    waits.get(key)?.()
    waits.delete(key)
  }
  return { deps, release, heliosCalls }
}

// The snapshot once the run ended.
function ended(
  request: SigningRequest,
  deps: Deps,
): Promise<Verification> & { store: ReturnType<typeof startVerification> } {
  const store = startVerification(request, deps)
  const promise = new Promise<Verification>((resolve, reject) => {
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
  return Object.assign(promise, { store })
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const statesOf = (v: Verification) =>
  v.contracts.map(({ address, foundBy, helios, sourcify }) => [address, foundBy, helios.status, sourcify.status])

test('the named contract and one the simulation found: both verified, the found one with the code of the simulation', async () => {
  const world: World = {
    codes: { [A]: '0x60', [B]: '0x61' },
    sources: { [A]: 'verified', [B]: 'verified' },
    touched: [A, B],
  }
  const { deps, heliosCalls } = setup(world)
  const v = await ended(transaction(A), deps)
  assert.equal(v.status, 'passed')
  assert.deepEqual(statesOf(v), [
    [A, 'request', 'passed', 'passed'],
    [B, 'simulation', 'passed', 'passed'],
  ])
  assert.deepEqual(heliosCalls, [A])
  assert.equal(v.simulation.status, 'passed')
  const texts = v.lines.map((line) => line.text)
  assert.ok(texts.includes(`eth_getCode ${B} · 1 bytes · read by the simulation`))
  assert.equal(texts.at(-1), '2/2 contracts verified')
})

test('a found contract with nothing on Sourcify flags the request', async () => {
  const world: World = { codes: { [A]: '0x60', [B]: '0x61' }, sources: { [A]: 'verified' }, touched: [A, B] }
  const v = await ended(transaction(A), setup(world).deps)
  assert.equal(v.status, 'flagged')
  assert.equal(v.lines.at(-1)?.text, '1/2 contracts verified · 1 not verified on Sourcify')
  assert.equal(v.lines.at(-1)?.ok, true)
})

test('a named contract with nothing on Sourcify fails the request', async () => {
  const world: World = { codes: { [A]: '0x60' }, sources: {}, touched: [A] }
  const v = await ended(transaction(A), setup(world).deps)
  assert.equal(v.status, 'failed')
  assert.equal(v.lines.at(-1)?.ok, false)
})

test('a found contract whose sources do not match fails the request', async () => {
  const world: World = {
    codes: { [A]: '0x60', [B]: '0x61' },
    sources: { [A]: 'verified', [B]: 'not reproduced' },
    touched: [A, B],
  }
  assert.equal((await ended(transaction(A), setup(world).deps)).status, 'failed')
})

test('a revert in the simulation: the request ends with reverts', async () => {
  const world: World = { codes: { [A]: '0x60' }, sources: { [A]: 'verified' }, touched: [A], revert: 'nope' }
  const reverted = await ended(transaction(A), setup(world).deps)
  assert.equal(reverted.status, 'reverts')
  assert.deepEqual(reverted.lines.at(-1)?.text, '1/1 contracts verified · the transaction reverts')
  assert.equal(reverted.lines.at(-1)?.ok, false)
})

test('a simulation that fails: the call tree is not checked, the named contract keeps its own result', async () => {
  const world: World = {
    codes: { [A]: '0x60' },
    sources: { [A]: 'verified' },
    simulationFails: 'the chain did not answer',
  }
  const v = await ended(transaction(A), setup(world).deps)
  assert.equal(v.status, 'flagged')
  assert.deepEqual(statesOf(v), [[A, 'request', 'passed', 'passed']])
  assert.deepEqual(v.simulation, { status: 'failed', reason: 'the chain did not answer' })
  assert.equal(v.lines.at(-1)?.text, '1/1 contracts verified · call tree not checked · the chain did not answer')
})

test('too many contracts in the call tree: the simulation fails, the request is flagged', async () => {
  const touched = Array.from(
    { length: MAX_CONTRACTS + 1 },
    (_, n) => `0x${(n + 1).toString(16).padStart(40, '0')}` as Hex,
  )
  const world: World = { codes: { [A]: '0x60' }, sources: { [A]: 'verified' }, touched }
  const v = await ended(transaction(A), setup(world).deps)
  assert.equal(v.status, 'flagged')
  assert.equal(v.contracts.length, 1)
  assert.deepEqual(v.simulation, { status: 'failed', reason: `more than ${MAX_CONTRACTS} contracts in the call tree` })
})

test('a contract creation: nothing to read, not simulated, so the request is flagged', async () => {
  const v = await ended(transaction(undefined), setup({ codes: {}, sources: {} }).deps)
  assert.equal(v.status, 'flagged')
  assert.equal(v.runs, true)
  assert.deepEqual(v.simulation, { status: 'skipped', reason: 'contract creation · not simulated' })
  assert.ok(
    v.lines.some((line) => line.source === 'evm' && line.text === 'not simulated · contract creation · not simulated'),
  )
  assert.match(v.lines.at(-1)?.text ?? '', /call tree not checked · contract creation · not simulated$/)
})

test('a batch without a sender: its contracts are checked, the request is flagged', async () => {
  const batch = request('wallet_sendCalls', [{ calls: [{ to: A }, { to: B }] }])
  const world: World = { codes: { [A]: '0x60', [B]: '0x61' }, sources: { [A]: 'verified', [B]: 'verified' } }
  const v = await ended(batch, setup(world).deps)
  assert.equal(v.status, 'flagged')
  assert.deepEqual(statesOf(v), [
    [A, 'request', 'passed', 'passed'],
    [B, 'request', 'passed', 'passed'],
  ])
  assert.deepEqual(v.simulation, { status: 'skipped', reason: 'the request names no sender' })
  assert.equal(v.lines.at(-1)?.text, '2/2 contracts verified · call tree not checked · the request names no sender')
})

test('typed data: the contract is checked, the simulation is skipped', async () => {
  const typed = JSON.stringify({ domain: { chainId: 1, verifyingContract: A } })
  const world: World = { codes: { [A]: '0x60' }, sources: { [A]: 'verified' } }
  const v = await ended(request('eth_signTypedData_v4', [FROM, typed], null), setup(world).deps)
  assert.equal(v.status, 'passed')
  assert.equal(v.runs, false)
  assert.deepEqual(v.simulation, { status: 'skipped', reason: 'a signature only · nothing runs on chain' })
})

test('a request with a field that does not read fails before any gate runs', async () => {
  const { deps, heliosCalls } = setup({ codes: { [A]: '0x6001' }, sources: { [A]: 'verified' } })
  const decimal = request('eth_sendTransaction', [
    { from: FROM, to: A, data: '0x12345678', value: '1000000000000000000' },
  ])
  const v = await ended(decimal, deps)
  assert.equal(v.status, 'failed')
  assert.deepEqual(heliosCalls, [])
  assert.match(v.lines.map((line) => line.text).join('\n'), /could not be read .* value/)
  const bare = request('eth_sendTransaction', [{ from: FROM, to: A.slice(2), data: '0x12345678' }])
  assert.equal((await ended(bare, deps)).status, 'failed')
})

test('a message names no chain: the run passes with nothing to check', async () => {
  const v = await ended(request('personal_sign', ['0x68656c6c6f', FROM], null), setup({ codes: {}, sources: {} }).deps)
  assert.equal(v.status, 'passed')
  assert.equal(v.simulation.status, 'skipped')
})

const delegated: Hex = `0xef0100${C.slice(2)}`

test('a named account with a delegate skips Sourcify, and its delegate counts as named', async () => {
  const world: World = {
    codes: { [A]: delegated, [C]: '0x62' },
    sources: { [C]: 'verified' },
    touched: [A, C],
    contexts: { [C]: [A] },
  }
  const v = await ended(transaction(A), setup(world).deps)
  assert.equal(v.status, 'passed')
  assert.deepEqual(statesOf(v), [
    [A, 'request', 'passed', 'skipped'],
    [C, 'request', 'passed', 'passed'],
  ])
  assert.equal(v.contracts[1].implementationOf, A)
  assert.match(v.lines.find((line) => line.address === A && line.source === 'sourcify')?.text ?? '', /delegate/)
})

test('the delegate of a named account with nothing on Sourcify fails the request', async () => {
  const world: World = { codes: { [A]: delegated, [C]: '0x62' }, sources: {}, touched: [A, C], contexts: { [C]: [A] } }
  const v = await ended(transaction(A), setup(world).deps)
  assert.equal(v.status, 'failed')
  assert.deepEqual(statesOf(v)[1], [C, 'request', 'passed', 'failed'])
})

test('the implementation of a named proxy with nothing on Sourcify fails the request', async () => {
  const world: World = {
    codes: { [A]: '0x60', [B]: '0x61' },
    sources: { [A]: 'verified' },
    touched: [A, B],
    contexts: { [B]: [A] },
  }
  const v = await ended(transaction(A), setup(world).deps)
  assert.equal(v.status, 'failed')
  assert.deepEqual(statesOf(v), [
    [A, 'request', 'passed', 'passed'],
    [B, 'request', 'passed', 'failed'],
  ])
  assert.equal(v.contracts[1].implementationOf, A)
})

test('an implementation the simulation found counts as named, with the code of the simulation', async () => {
  const world: World = {
    codes: { [A]: '0x60', [B]: '0x61' },
    sources: { [A]: 'verified', [B]: 'verified' },
    touched: [A, B],
    contexts: { [B]: [A] },
  }
  const { deps, heliosCalls } = setup(world)
  const v = await ended(transaction(A), deps)
  assert.equal(v.status, 'passed')
  assert.deepEqual(statesOf(v)[1], [B, 'request', 'passed', 'passed'])
  assert.equal(v.contracts[1].implementationOf, A)
  assert.deepEqual(heliosCalls, [A])
})

test('a library that a contract on the way delegatecalls stays on the way', async () => {
  const world: World = {
    codes: { [A]: '0x60', [B]: '0x61', [C]: '0x62' },
    sources: { [A]: 'verified', [B]: 'verified' },
    touched: [A, B, C],
    contexts: { [C]: [B] },
  }
  const v = await ended(transaction(A), setup(world).deps)
  assert.equal(v.status, 'flagged')
  assert.deepEqual(statesOf(v)[2], [C, 'simulation', 'passed', 'failed'])
  assert.equal(v.contracts[2].implementationOf, undefined)
})

test('the delegate of an account on the way is one more contract on the way', async () => {
  const world: World = {
    codes: { [A]: '0x60', [B]: delegated, [C]: '0x62' },
    sources: { [A]: 'verified' },
    touched: [A, B, C],
    contexts: { [C]: [B] },
  }
  const v = await ended(transaction(A), setup(world).deps)
  assert.equal(v.status, 'flagged')
  assert.deepEqual(statesOf(v), [
    [A, 'request', 'passed', 'passed'],
    [B, 'simulation', 'passed', 'skipped'],
    [C, 'simulation', 'passed', 'failed'],
  ])
  assert.equal(v.contracts[2].implementationOf, undefined)
})

test('the chain is not ready: the chain gate fails, the other gates did not start', async () => {
  const v = await ended(transaction(A), setup({ codes: {}, sources: {}, chainFails: 'Helios did not sync' }).deps)
  assert.equal(v.status, 'failed')
  assert.deepEqual(v.contracts[0].helios, { status: 'failed', reason: 'Helios did not sync' })
  assert.deepEqual(v.contracts[0].sourcify, { status: 'skipped', reason: 'the chain was not read' })
  assert.deepEqual(v.simulation, { status: 'skipped', reason: 'the chain was not read' })
})

test('typed data on an account with a delegate: the delegate is checked without a simulation', async () => {
  const typed = JSON.stringify({ domain: { chainId: 1, verifyingContract: A } })
  const world: World = { codes: { [A]: delegated, [C]: '0x62' }, sources: { [C]: 'verified' } }
  const { deps, heliosCalls } = setup(world)
  const v = await ended(request('eth_signTypedData_v4', [FROM, typed], null), deps)
  assert.equal(v.status, 'passed')
  assert.deepEqual(statesOf(v), [
    [A, 'request', 'passed', 'skipped'],
    [C, 'request', 'passed', 'passed'],
  ])
  assert.equal(v.contracts[1].implementationOf, A)
  assert.deepEqual(heliosCalls, [A, C])
  const unverified = await ended(
    request('eth_signTypedData_v4', [FROM, typed], null),
    setup({ ...world, sources: {} }).deps,
  )
  assert.equal(unverified.status, 'failed')
})

test('the run waits for the contracts the simulation finds, even after the named checks ended', async () => {
  const world: World = {
    codes: { [A]: '0x60', [B]: '0x61' },
    sources: { [A]: 'verified', [B]: 'verified' },
    touched: [A, B],
    hold: ['simulation', `sourcify:${B}`],
  }
  const { deps, release } = setup(world)
  const run = ended(transaction(A), deps)
  await tick()
  let snapshot = run.store.getSnapshot()
  assert.equal(snapshot.contracts[0].sourcify.status, 'passed')
  assert.equal(snapshot.status, 'running')
  release('simulation')
  await tick()
  snapshot = run.store.getSnapshot()
  assert.equal(snapshot.simulation.status, 'passed')
  assert.equal(snapshot.contracts.length, 2)
  assert.equal(snapshot.status, 'running')
  release(`sourcify:${B}`)
  assert.equal((await run).status, 'passed')
})
