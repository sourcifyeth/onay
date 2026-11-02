import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Hex } from '../src/messages.ts'
import {
  add,
  addImplementation,
  grow,
  initial,
  runVerdict,
  MAX_CONTRACTS,
  pending,
  progressOf,
  progressOfSimulation,
  progressShown,
  tally,
  update,
  verdictOf,
  type Contract,
} from '../src/gates/contracts.ts'
import type { GateState } from '../src/gates/gate.ts'
import type { Simulation, Touched } from '../src/gates/simulation.ts'
import type { Verified } from '../src/gates/verify.ts'

const A: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const B: Hex = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function address(n: number): Hex {
  return `0x${n.toString(16).padStart(40, '0')}`
}

const waiting = { status: 'waiting' } as const
const verified = {
  claim: {} as Verified['claim'],
  runtimeMatch: 'perfect',
  creationMatch: null,
  creationNote: 'Sourcify does not know the creation transaction',
  creation: null,
  transformations: { runtime: { list: [], values: {} }, creation: { list: [], values: {} } },
  abi: [],
} satisfies Verified
const passed = { status: 'passed', value: verified } as const
const code = (contract: Contract) => ({ address: contract.address, block: 1, code: '0x60' as Hex })

test('initial: one waiting contract for each address, in the order of the request', () => {
  assert.deepEqual(initial([A, B]), [
    { address: A, foundBy: 'request', helios: waiting, sourcify: waiting },
    { address: B, foundBy: 'request', helios: waiting, sourcify: waiting },
  ])
  assert.deepEqual(initial([]), [])
})

test('add: a new address goes at the end, in lower case', () => {
  const contracts = add([], A.toUpperCase().replace('0X', '0x') as Hex, 'simulation')
  assert.deepEqual(contracts, [{ address: A, foundBy: 'simulation', helios: waiting, sourcify: waiting }])
})

test('add: an address that is in the list gives the same list, whatever its case', () => {
  const contracts = initial([A])!
  assert.equal(add(contracts, A, 'simulation'), contracts)
  assert.equal(add(contracts, A.toUpperCase().replace('0X', '0x') as Hex, 'request'), contracts)
})

test('add: a full list gives null, and so does a request with too many contracts', () => {
  const addresses = Array.from({ length: MAX_CONTRACTS }, (_, n) => address(n + 1))
  const full = initial(addresses)!
  assert.equal(full.length, MAX_CONTRACTS)
  assert.equal(add(full, A, 'simulation'), null)
  assert.equal(add(full, addresses[0], 'simulation'), full)
  assert.equal(initial([...addresses, A]), null)
})

test('addImplementation: a new implementation counts as named, with its proxy', () => {
  const contracts = initial([A])!
  assert.deepEqual(addImplementation(contracts, A, B.toUpperCase().replace('0X', '0x') as Hex), [
    ...contracts,
    { address: B, foundBy: 'request', implementationOf: A, helios: waiting, sourcify: waiting },
  ])
})

test('addImplementation: an implementation the simulation found is promoted, and keeps its states', () => {
  const found = update(add(initial([A])!, B, 'simulation')!, B, {
    helios: { status: 'passed', value: code({ address: B } as Contract) },
    sourcify: passed,
  })
  const contracts = addImplementation(found, A, B)!
  assert.deepEqual(contracts[0], found[0])
  assert.deepEqual(contracts[1], { ...found[1], foundBy: 'request', implementationOf: A })
})

test('addImplementation: a full list gives null', () => {
  const full = initial(Array.from({ length: MAX_CONTRACTS }, (_, n) => address(n + 1)))!
  assert.equal(addImplementation(full, address(1), A), null)
})

test('update takes the address in any case', () => {
  const contracts = initial([A, B])!
  const upper = B.toUpperCase().replace('0X', '0x') as Hex
  assert.equal(update(contracts, upper, { helios: { status: 'running' } })[1].helios.status, 'running')
})

test('update changes the states of one contract and keeps the others', () => {
  const contracts = initial([A, B])!
  const changed = update(contracts, B, { helios: { status: 'running' } })
  assert.deepEqual(changed, [
    { address: A, foundBy: 'request', helios: waiting, sourcify: waiting },
    { address: B, foundBy: 'request', helios: { status: 'running' }, sourcify: waiting },
  ])
  assert.deepEqual(contracts[1].helios, waiting)
})

test('pending while a gate of a contract waits or runs, not when each one passed or failed', () => {
  let contracts = initial([A, B])!
  assert.equal(pending(contracts), true)
  contracts = update(contracts, A, { sourcify: passed, helios: { status: 'passed', value: code(contracts[0]) } })
  assert.equal(pending(contracts), true)
  contracts = update(contracts, B, { sourcify: passed, helios: { status: 'running' } })
  assert.equal(pending(contracts), true)
  contracts = update(contracts, B, { helios: { status: 'failed', reason: 'no proof' } })
  assert.equal(pending(contracts), false)
  assert.deepEqual(tally(contracts), { pending: 0, passed: 1, flagged: 0, failed: 1 })
  assert.equal(pending([]), false)
})

test('a contract passed when each of its gates passed or had nothing to check', () => {
  let contracts = initial([A, B])!
  contracts = update(contracts, A, { helios: { status: 'passed', value: code(contracts[0]) } })
  assert.equal(verdictOf(contracts[0]), 'pending')
  contracts = update(contracts, A, { sourcify: passed })
  assert.equal(verdictOf(contracts[0]), 'passed')
  contracts = update(contracts, B, { helios: { status: 'passed', value: code(contracts[1]) } })
  contracts = update(contracts, B, { sourcify: { status: 'skipped', reason: 'not a contract' } })
  assert.deepEqual(tally(contracts), { pending: 0, passed: 2, flagged: 0, failed: 0 })
  assert.equal(pending(contracts), false)
})

test('a contract added during the run makes the list pending again', () => {
  let contracts = initial([A])!
  contracts = update(contracts, A, { sourcify: passed, helios: { status: 'passed', value: code(contracts[0]) } })
  assert.equal(pending(contracts), false)
  contracts = add(contracts, B, 'simulation')!
  assert.equal(pending(contracts), true)
  assert.deepEqual(tally(contracts), { pending: 1, passed: 1, flagged: 0, failed: 0 })
})

const notVerified = { status: 'failed', reason: 'not verified on Sourcify', cause: { kind: 'not verified' } } as const
const notReproduced = {
  status: 'failed',
  reason: 'not the code',
  cause: { kind: 'not reproduced', claim: {} },
} as const

test('a contract the simulation found, with nothing on Sourcify, is flagged', () => {
  let contracts = add(initial([A])!, B, 'simulation')!
  contracts = update(contracts, B, { helios: { status: 'passed', value: code(contracts[1]) }, sourcify: notVerified })
  assert.equal(verdictOf(contracts[1]), 'flagged')
  assert.equal(pending(contracts), true)
  assert.deepEqual(tally(contracts), { pending: 1, passed: 0, flagged: 1, failed: 0 })
})

test('a contract the request names, with nothing on Sourcify, fails', () => {
  let contracts = initial([A])!
  contracts = update(contracts, A, { helios: { status: 'passed', value: code(contracts[0]) }, sourcify: notVerified })
  assert.equal(verdictOf(contracts[0]), 'failed')
})

test('a found contract fails when its code was not read, or its sources do not match', () => {
  let contracts = add([], B, 'simulation')!
  const failed = { status: 'failed', reason: 'the code was not read' } as const
  assert.equal(verdictOf(update(contracts, B, { helios: failed, sourcify: notVerified })[0]), 'failed')
  contracts = update(contracts, B, { helios: { status: 'passed', value: code(contracts[0]) } })
  assert.equal(verdictOf(update(contracts, B, { sourcify: notReproduced })[0]), 'failed')
  assert.equal(verdictOf(update(contracts, B, { sourcify: { status: 'failed', reason: 'HTTP 500' } })[0]), 'failed')
})

const C: Hex = '0xcccccccccccccccccccccccccccccccccccccccc'
const touched = (address: Hex, ...contexts: Hex[]): Touched => ({ address, block: 1, code: '0x60', contexts })

test('grow: a contract on the way, an implementation of a named contract, and one already named', () => {
  const contracts = grow(initial([A])!, [touched(A, A), touched(B, A), touched(C, C)])!
  assert.deepEqual(
    contracts.map(({ address, foundBy, implementationOf }) => [address, foundBy, implementationOf]),
    [
      [A, 'request', undefined],
      [B, 'request', A],
      [C, 'simulation', undefined],
    ],
  )
})

test('grow: code that ran in the context of an implementation, not of a named contract, stays on the way', () => {
  const contracts = grow(initial([A])!, [touched(B, A), touched(C, B)])!
  assert.equal(contracts[2].foundBy, 'simulation')
})

test('grow: a full list gives null', () => {
  const full = initial(Array.from({ length: MAX_CONTRACTS }, (_, n) => address(n + 1)))!
  assert.equal(grow(full, [touched(A, A)]), null)
  assert.equal(grow(full, [touched(address(1), address(1))]), full)
})

const simulated = (reverts: boolean): GateState<Simulation> => ({
  status: 'passed',
  value: {
    header: {
      number: 1,
      timestamp: 0,
      gasLimit: 0n,
      baseFee: null,
      coinbase: A,
      prevRandao: '0x',
      excessBlobGas: null,
    },
    calls: [{ call: { from: A, to: B, data: '0x', value: 0n, gas: null }, frames: [], error: reverts ? 'nope' : null }],
    touched: [],
    reads: { accounts: 0, slots: 0 },
  },
})
const verifiedContract = (address: Hex, foundBy: 'request' | 'simulation' = 'request'): Contract => ({
  address,
  foundBy,
  helios: { status: 'passed', value: { address, block: 1, code: '0x60' } },
  sourcify: passed,
})

test('runVerdict: passed when every contract passed and the simulation ran through', () => {
  assert.deepEqual(runVerdict([verifiedContract(A)], simulated(false), true), { status: 'passed', notes: [] })
})

test('runVerdict: a contract on the way without sources flags, a named one fails', () => {
  const onTheWay = { ...verifiedContract(B, 'simulation'), sourcify: notVerified }
  assert.deepEqual(runVerdict([verifiedContract(A), onTheWay], simulated(false), true), {
    status: 'flagged',
    notes: ['1 not verified on Sourcify'],
  })
  const named = { ...verifiedContract(B), sourcify: notVerified }
  assert.equal(runVerdict([verifiedContract(A), named], simulated(false), true).status, 'failed')
})

test('runVerdict: a revert is a result of its own, below a failed contract', () => {
  assert.deepEqual(runVerdict([verifiedContract(A)], simulated(true), true), {
    status: 'reverts',
    notes: ['the transaction reverts'],
  })
  const named = { ...verifiedContract(B), sourcify: notVerified }
  assert.equal(runVerdict([named], simulated(true), true).status, 'failed')
})

test('runVerdict: a simulation that was skipped or failed flags a transaction, not a signature', () => {
  const skipped = { status: 'skipped', reason: 'contract creation · not simulated' } as const
  assert.deepEqual(runVerdict([verifiedContract(A)], skipped, true), {
    status: 'flagged',
    notes: ['call tree not checked · contract creation · not simulated'],
  })
  const failed = { status: 'failed', reason: 'the chain did not answer' } as const
  assert.deepEqual(runVerdict([verifiedContract(A)], failed, true), {
    status: 'flagged',
    notes: ['call tree not checked · the chain did not answer'],
  })
  const signature = { status: 'skipped', reason: 'a signature only · nothing runs on chain' } as const
  assert.deepEqual(runVerdict([verifiedContract(A)], signature, false), { status: 'passed', notes: [] })
})

test('progressOf: a gate waits until a contract runs, and runs while any contract waits', () => {
  const [a, b] = initial([A, B])!
  const read = { status: 'passed', value: code(a) } as const
  assert.equal(progressOf([a, b], 'helios'), 'waiting')
  assert.equal(progressOf([{ ...a, helios: { status: 'running' } }, b], 'helios'), 'running')
  assert.equal(progressOf([{ ...a, helios: read }, b], 'helios'), 'running')
  assert.equal(
    progressOf(
      [
        { ...a, helios: read },
        { ...b, helios: read },
      ],
      'helios',
    ),
    'passed',
  )
})

test('progressOf: the ends of a gate, and a failure that only warns', () => {
  const [a, b] = initial([A, B])!
  const read = { status: 'passed', value: code(a) } as const
  const skipped = { status: 'skipped', reason: 'no code' } as const
  const failed = { status: 'failed', reason: 'no proof' } as const
  assert.equal(progressOf([], 'helios'), 'skipped')
  assert.equal(
    progressOf(
      [
        { ...a, helios: skipped },
        { ...b, helios: skipped },
      ],
      'helios',
    ),
    'skipped',
  )
  assert.equal(
    progressOf(
      [
        { ...a, helios: read },
        { ...b, helios: skipped },
      ],
      'helios',
    ),
    'passed',
  )
  assert.equal(
    progressOf(
      [
        { ...a, helios: read },
        { ...b, helios: failed },
      ],
      'helios',
    ),
    'failed',
  )
  // Sourcify has nothing for a contract on the way: a warning, not a failure.
  const named = { ...a, helios: read, sourcify: passed }
  const onTheWay = { ...b, foundBy: 'simulation', helios: read, sourcify: notVerified } as const
  assert.equal(progressOf([named, onTheWay], 'sourcify'), 'flagged')
  assert.equal(progressOf([named, { ...onTheWay, foundBy: 'request' }], 'sourcify'), 'failed')
})

test('progressOfSimulation: the status of the gate, and a revert warns', () => {
  assert.equal(progressOfSimulation({ status: 'waiting' }), 'waiting')
  assert.equal(progressOfSimulation({ status: 'running' }), 'running')
  assert.equal(progressOfSimulation({ status: 'skipped', reason: 'a signature' }), 'skipped')
  assert.equal(progressOfSimulation({ status: 'failed', reason: 'no state' }), 'failed')
  const call = { error: null } as Simulation['calls'][number]
  assert.equal(progressOfSimulation({ status: 'passed', value: { calls: [call] } as Simulation }), 'passed')
  const reverting = { ...call, error: 'revert' } as Simulation['calls'][number]
  assert.equal(progressOfSimulation({ status: 'passed', value: { calls: [reverting] } as Simulation }), 'flagged')
})

test('progressShown: a gate with lines does not wait', () => {
  // Helios syncs before any contract starts the gate.
  assert.equal(progressShown('waiting', false, true), 'running')
  assert.equal(progressShown('waiting', true, true), 'running')
  assert.equal(progressShown('waiting', false, false), 'waiting')
  assert.equal(progressShown('waiting', true, false), 'waiting')
})

test('progressShown: an end shows only after the log caught up', () => {
  for (const end of ['passed', 'flagged', 'failed', 'skipped'] as const) {
    assert.equal(progressShown(end, false, true), 'running', end)
    assert.equal(progressShown(end, true, true), end, end)
  }
  assert.equal(progressShown('running', true, true), 'running')
  assert.equal(progressShown('running', false, true), 'running')
})
