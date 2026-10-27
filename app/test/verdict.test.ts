import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DisplayModel } from '@ethereum-sourcify/clear-signing'
import type { ChainConfig } from '../src/chains.ts'
import type { Call, Rendering } from '../src/clear-signing/render.ts'
import type { ClearSigning } from '../src/clear-signing/store.ts'
import type { Contract } from '../src/gates/contracts.ts'
import type { GateState } from '../src/gates/gate.ts'
import type { Verification } from '../src/gates/run.ts'
import type { Simulation } from '../src/gates/simulation.ts'
import { stepsOf, stepVerdicts, type StepVerdict } from '../src/gates/verdict.ts'
import type { Verified } from '../src/gates/verify.ts'
import type { Hex } from '../src/messages.ts'

const A: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const B: Hex = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const HELIOS: ChainConfig = { id: 1, name: 'test', mode: 'helios', executionRpc: 'http://chain.invalid' }

const verified = {
  claim: {} as Verified['claim'],
  runtimeMatch: 'perfect',
  creationMatch: null,
  creationNote: null,
  transformations: { runtime: { list: [], values: {} }, creation: { list: [], values: {} } },
  abi: [],
} satisfies Verified
const notVerified = { status: 'failed', reason: 'not verified on Sourcify', cause: { kind: 'not verified' } } as const
const notReproduced = {
  status: 'failed',
  reason: 'not the code',
  cause: { kind: 'not reproduced', claim: {} },
} as const

const contract = (address: Hex, change: Partial<Contract> = {}): Contract => ({
  address,
  foundBy: 'request',
  helios: { status: 'passed', value: { address, block: 100, code: '0x60' } },
  sourcify: { status: 'passed', value: verified },
  ...change,
})

const simulated = (error: string | null = null): GateState<Simulation> => ({
  status: 'passed',
  value: {
    header: {
      number: 100,
      timestamp: 0,
      gasLimit: 0n,
      baseFee: null,
      coinbase: A,
      prevRandao: '0x',
      excessBlobGas: null,
    },
    calls: [{ call: { from: B, to: A, data: '0x', value: 0n, gas: null }, frames: [], error }],
    touched: [],
    reads: { accounts: 0, slots: 0 },
  },
})

// A transaction to A that passed every gate on a Helios chain.
const run = (change: Partial<Verification> = {}): Verification => ({
  chainId: 1,
  chain: HELIOS,
  head: { block: 100, checkpoint: null },
  runs: true,
  contracts: [contract(A)],
  simulation: simulated(),
  lines: [],
  status: 'passed',
  stopped: null,
  ...change,
})

const call = (change: Partial<Call> = {}): Call => ({
  to: A,
  data: '0x12345678',
  value: 0n,
  display: { intent: 'Swap' } as DisplayModel,
  verified: true,
  decoded: null,
  decodedBy: null,
  source: { kind: 'registry', path: 'registry/a.json' },
  attested: true,
  attestationError: null,
  ...change,
})

const clearSigning = (rendering: Rendering | null, change: Partial<ClearSigning> = {}): ClearSigning => ({
  status: 'done',
  rendering,
  registryError: null,
  attesters: [B],
  lines: [],
  ...change,
})

const rendered = (c: Call = call()) => clearSigning({ kind: 'transaction', from: B, call: c })

// The verdict of one step.
const of = (verdicts: StepVerdict[], step: StepVerdict['step']) => {
  const found = verdicts.find((verdict) => verdict.step === step)
  return found && { status: found.status, reason: found.reason }
}

test('stepsOf: with a chain, six steps in their order; without one, only the comparison', () => {
  assert.deepEqual(
    stepsOf({ chain: HELIOS }).map(({ id, number }) => [number, id]),
    [
      [1, 'chain'],
      [2, 'simulation'],
      [3, 'verification'],
      [4, 'profile'],
      [5, 'clearSigning'],
      [6, 'compare'],
    ],
  )
  assert.deepEqual(stepsOf({ chain: null }), [{ id: 'compare', title: 'Compare with your wallet', number: 1 }])
})

test('stepVerdicts: every step passed', () => {
  assert.deepEqual(stepVerdicts(run(), rendered()), [
    { step: 'chain', status: 'passed', reason: null },
    { step: 'simulation', status: 'passed', reason: null },
    { step: 'verification', status: 'passed', reason: null },
    { step: 'clearSigning', status: 'passed', reason: null },
  ])
})

test('stepVerdicts: a request that Onay could not check has one verdict, before any step', () => {
  const reason = 'chain 5 is not in the settings'
  assert.deepEqual(stepVerdicts(run({ chain: null, stopped: reason, status: 'failed' }), null), [
    { step: 'request', status: 'failed', reason },
  ])
})

test('stepVerdicts: a message without a chain has no step before the comparison', () => {
  assert.deepEqual(stepVerdicts(run({ chainId: null, chain: null, contracts: [], runs: false }), null), [])
})

test('chain: a chain that was not read, a contract whose code was not read, an RPC endpoint, no contract', () => {
  const notRead = { status: 'failed', reason: 'Helios did not sync' } as const
  const skipped = { status: 'skipped', reason: 'the chain was not read' } as const
  const unsynced = run({ head: null, contracts: [contract(A, { helios: notRead, sourcify: skipped })] })
  assert.deepEqual(of(stepVerdicts(unsynced, null), 'chain'), {
    status: 'failed',
    reason: 'the chain was not read · Helios did not sync',
  })
  const noProof = { status: 'failed', reason: 'no proof' } as const
  const one = run({ contracts: [contract(A), contract(B, { helios: noProof, sourcify: notVerified })] })
  assert.deepEqual(of(stepVerdicts(one, null), 'chain'), {
    status: 'failed',
    reason: 'the code of 0xbbbb…bbbb was not read · no proof',
  })
  assert.deepEqual(of(stepVerdicts(run({ chain: { ...HELIOS, mode: 'rpc' } }), null), 'chain'), {
    status: 'flagged',
    reason: 'the chain data comes from an RPC endpoint, without proof',
  })
  assert.deepEqual(of(stepVerdicts(run({ head: null, contracts: [] }), null), 'chain'), {
    status: 'skipped',
    reason: 'no contract to read',
  })
})

test('simulation: a revert fails, a call tree that was not checked warns, a signature has nothing to run', () => {
  assert.deepEqual(of(stepVerdicts(run({ simulation: simulated('nope') }), null), 'simulation'), {
    status: 'failed',
    reason: 'the transaction reverts · nope',
  })
  const creation = { status: 'skipped', reason: 'contract creation · not simulated' } as const
  assert.deepEqual(of(stepVerdicts(run({ simulation: creation }), null), 'simulation'), {
    status: 'flagged',
    reason: 'the call tree was not checked · contract creation · not simulated',
  })
  const timeout = { status: 'failed', reason: 'the chain did not answer' } as const
  assert.deepEqual(of(stepVerdicts(run({ simulation: timeout }), null), 'simulation'), {
    status: 'flagged',
    reason: 'the transaction could not be simulated · the chain did not answer',
  })
  const signature = { status: 'skipped', reason: 'a signature only · nothing runs on chain' } as const
  assert.deepEqual(of(stepVerdicts(run({ simulation: signature, runs: false }), null), 'simulation'), {
    status: 'skipped',
    reason: 'a signature only · nothing runs on chain',
  })
})

test('verification: a named contract without sources fails, with the count of the others that fail', () => {
  const one = run({ contracts: [contract(A, { sourcify: notVerified })] })
  assert.deepEqual(of(stepVerdicts(one, null), 'verification'), {
    status: 'failed',
    reason: '0xaaaa…aaaa has no verified source code on Sourcify',
  })
  const two = run({ contracts: [contract(A, { sourcify: notReproduced }), contract(B, { sourcify: notVerified })] })
  assert.deepEqual(of(stepVerdicts(two, null), 'verification'), {
    status: 'failed',
    reason: '0xaaaa…aaaa does not match its sources on Sourcify · and 1 more',
  })
})

test('verification: a contract on the way without sources warns', () => {
  const onTheWay = contract(B, { foundBy: 'simulation', sourcify: notVerified })
  assert.deepEqual(of(stepVerdicts(run({ contracts: [contract(A), onTheWay] }), null), 'verification'), {
    status: 'flagged',
    reason: '0xbbbb…bbbb is called on the way and has no verified source code',
  })
})

test('verification: a contract whose code was not read is left to the chain step, an account without code too', () => {
  const noProof = { status: 'failed', reason: 'no proof' } as const
  const notRead = { status: 'failed', reason: 'the code was not read' } as const
  const verdicts = stepVerdicts(run({ contracts: [contract(A, { helios: noProof, sourcify: notRead })] }), null)
  assert.equal(of(verdicts, 'chain')?.status, 'failed')
  assert.deepEqual(of(verdicts, 'verification'), { status: 'skipped', reason: 'no contract code to verify' })
  const account = contract(A, {
    helios: { status: 'passed', value: { address: A, block: 100, code: '0x' } },
    sourcify: { status: 'skipped', reason: 'not a contract' },
  })
  assert.deepEqual(of(stepVerdicts(run({ contracts: [account] }), null), 'verification'), {
    status: 'skipped',
    reason: 'no contract code to verify',
  })
})

test('clearSigning: a preview warns, with the reason why no trusted auditor attested it', () => {
  const preview = call({ attested: false })
  assert.deepEqual(of(stepVerdicts(run(), rendered(preview)), 'clearSigning'), {
    status: 'flagged',
    reason: 'no auditor you trust attested the descriptor',
  })
  const noAuditor = clearSigning({ kind: 'transaction', from: B, call: preview }, { attesters: [] })
  assert.deepEqual(of(stepVerdicts(run(), noAuditor), 'clearSigning'), {
    status: 'flagged',
    reason: 'the descriptor is a preview, since you trust no auditor yet',
  })
  const unchecked = call({ attested: false, attestationError: 'HTTP 503' })
  assert.deepEqual(of(stepVerdicts(run(), rendered(unchecked)), 'clearSigning'), {
    status: 'flagged',
    reason: 'the attestation of the descriptor could not be checked · HTTP 503',
  })
})

test('clearSigning: a call that only the ABI decodes is no warning, one that nothing decodes is', () => {
  const decoded = { name: 'transfer', selector: '0x12345678' as Hex, signature: 'transfer()', params: [] }
  const abiOnly = call({ display: {} as DisplayModel, source: null, decoded })
  assert.deepEqual(of(stepVerdicts(run(), rendered(abiOnly)), 'clearSigning'), {
    status: 'skipped',
    reason: 'no descriptor · the verified ABI decodes the call',
  })
  const raw = call({ display: {} as DisplayModel, source: null })
  assert.deepEqual(of(stepVerdicts(run(), rendered(raw)), 'clearSigning'), {
    status: 'flagged',
    reason: 'neither a descriptor nor the verified ABI decodes the call',
  })
  const creation = call({ to: null, display: null })
  assert.equal(of(stepVerdicts(run(), rendered(creation)), 'clearSigning')?.status, 'flagged')
  const transfer = call({ data: '0x', display: null })
  assert.equal(of(stepVerdicts(run(), rendered(transfer)), 'clearSigning')?.status, 'passed')
})

test('clearSigning: a batch takes the warning of its first call that warns, with its number', () => {
  const batch = (calls: Call[]) => clearSigning({ kind: 'batch', from: B, calls, intent: null, warnings: [] })
  const raw = call({ display: {} as DisplayModel, source: null })
  assert.deepEqual(of(stepVerdicts(run(), batch([call(), raw, raw])), 'clearSigning'), {
    status: 'flagged',
    reason: 'call 2 · neither a descriptor nor the verified ABI decodes the call · and 1 more',
  })
  assert.equal(of(stepVerdicts(run(), batch([call(), call({ data: '0x' })])), 'clearSigning')?.status, 'passed')
})

test('clearSigning: still running, a rendering that failed, nothing to render', () => {
  assert.equal(of(stepVerdicts(run(), clearSigning(null, { status: 'running' })), 'clearSigning')?.status, 'running')
  assert.deepEqual(of(stepVerdicts(run(), clearSigning(null)), 'clearSigning'), {
    status: 'flagged',
    reason: 'the rendering failed',
  })
  const none = clearSigning({ kind: 'none', reason: 'eth_sign is not covered' })
  assert.deepEqual(of(stepVerdicts(run(), none), 'clearSigning'), {
    status: 'skipped',
    reason: 'eth_sign is not covered',
  })
})
