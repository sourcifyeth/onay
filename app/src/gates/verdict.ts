// The steps of the review, and the verdict of each one with its reason.
// The steps take their numbers and titles from one list, so a heading
// and a verdict cannot disagree on the number of a step. The compare
// step shows the verdicts, so it can say which step failed and why.
// This module has no browser or Tauri calls, so the tests run it as it
// is.

import type { ClearSigning } from '../clear-signing/store.ts'
import { rendered, type Call } from '../clear-signing/render.ts'
import { verdictOf, type Contract } from './contracts.ts'
import type { Verification } from './run.ts'
import { failureOf } from './sourcify.ts'
import { short } from './words.ts'

export type StepId = 'chain' | 'simulation' | 'verification' | 'profile' | 'clearSigning' | 'compare'

export type StepInfo = { id: StepId; number: number; title: string }

const STEPS: { id: StepId; title: string }[] = [
  { id: 'chain', title: 'Chain Data Verification' },
  { id: 'simulation', title: 'Transaction Simulation' },
  { id: 'verification', title: 'Source Code Verification' },
  { id: 'profile', title: 'Contract Profile' },
  { id: 'clearSigning', title: 'Clear Signing' },
  { id: 'compare', title: 'Compare with your wallet' },
]

// The steps that the review shows, with their numbers. Without a chain
// no gate ran, so only the comparison shows.
export function stepsOf({ chain }: Pick<Verification, 'chain'>): StepInfo[] {
  const shown = chain ? STEPS : STEPS.filter((step) => step.id === 'compare')
  return shown.map((step, index) => ({ ...step, number: index + 1 }))
}

export type StepStatus = 'running' | 'passed' | 'flagged' | 'failed' | 'skipped'

// 'request' is no step: Onay could not check the request, so the run
// stopped before the first step. The profile has no verdict: nothing it
// finds changes the result.
export type StepVerdict = {
  step: Exclude<StepId, 'compare' | 'profile'> | 'request'
  status: StepStatus
  reason: string | null
}

type Result = Omit<StepVerdict, 'step'>

const PASSED: Result = { status: 'passed', reason: null }
const RUNNING: Result = { status: 'running', reason: null }
const flagged = (reason: string): Result => ({ status: 'flagged', reason })
const failed = (reason: string): Result => ({ status: 'failed', reason })
const skipped = (reason: string): Result => ({ status: 'skipped', reason })

const more = (text: string, count: number) => (count > 1 ? `${text} · and ${count - 1} more` : text)

// The verdicts of the steps before the comparison, in their order. The
// Clear Signing result is null if Clear Signing did not start.
export function stepVerdicts(verification: Verification, clearSigning: ClearSigning | null): StepVerdict[] {
  if (verification.stopped !== null) return [{ step: 'request', status: 'failed', reason: verification.stopped }]
  if (!verification.chain) return []
  const verdicts: StepVerdict[] = [
    { step: 'chain', ...chainVerdict(verification) },
    { step: 'simulation', ...simulationVerdict(verification) },
    { step: 'verification', ...sourceVerdict(verification) },
  ]
  if (clearSigning) verdicts.push({ step: 'clearSigning', ...clearSigningVerdict(clearSigning) })
  return verdicts
}

// An endpoint without Helios gives no proof, so its answers only warn.
function chainVerdict({ chain, head, contracts }: Verification): Result {
  for (const { address, helios } of contracts) {
    if (helios.status !== 'failed') continue
    return failed(
      head === null
        ? `the chain was not read · ${helios.reason}`
        : `the code of ${short(address)} was not read · ${helios.reason}`,
    )
  }
  if (contracts.some(({ helios }) => helios.status === 'waiting' || helios.status === 'running')) return RUNNING
  if (contracts.length === 0) return skipped('no contract to read')
  if (chain?.mode !== 'helios') return flagged('the chain data comes from an RPC endpoint, without proof')
  return PASSED
}

// A transaction that was not simulated leaves its call tree unchecked.
// A signature runs nothing, so it has nothing to simulate.
function simulationVerdict({ simulation, runs }: Verification): Result {
  switch (simulation.status) {
    case 'waiting':
    case 'running':
      return RUNNING
    case 'skipped':
      return runs ? flagged(`the call tree was not checked · ${simulation.reason}`) : skipped(simulation.reason)
    case 'failed':
      return flagged(`the transaction could not be simulated · ${simulation.reason}`)
    case 'passed': {
      const revert = simulation.value.calls.find((call) => call.error !== null)
      if (!revert) return PASSED
      return failed(revert.error ? `the transaction reverts · ${revert.error}` : 'the transaction reverts')
    }
  }
}

// A contract whose code was not read fails the chain step, so this step
// leaves it out.
function sourceVerdict({ contracts }: Verification): Result {
  if (contracts.some((contract) => verdictOf(contract) === 'pending')) return RUNNING
  const read = contracts.filter(({ helios }) => helios.status === 'passed' && helios.value.code !== '0x')
  if (read.length === 0) return skipped('no contract code to verify')
  const failures = read.filter((contract) => verdictOf(contract) === 'failed')
  if (failures.length > 0) return failed(more(sourceProblem(failures[0]), failures.length))
  const unverified = read.filter((contract) => verdictOf(contract) === 'flagged')
  if (unverified.length > 0) {
    const first = `${short(unverified[0].address)} is called on the way and has no verified source code`
    return flagged(more(first, unverified.length))
  }
  return PASSED
}

function sourceProblem({ address, sourcify }: Contract): string {
  const failure = failureOf(sourcify)
  if (failure?.kind === 'not verified') return `${short(address)} has no verified source code on Sourcify`
  if (failure?.kind === 'not reproduced') return `${short(address)} does not match its sources on Sourcify`
  return `${short(address)} · ${sourcify.status === 'failed' ? sourcify.reason : 'not checked'}`
}

// A descriptor that no trusted auditor attested only warns, and so does a
// call that nothing decodes. A call that only the verified ABI decodes
// has no descriptor, which is no warning.
function clearSigningVerdict(state: ClearSigning): Result {
  if (state.status === 'running') return RUNNING
  const { rendering } = state
  if (!rendering) return flagged('the rendering failed')
  switch (rendering.kind) {
    case 'none':
      return skipped(rendering.reason)
    case 'transaction':
      return callVerdict(rendering.call, state)
    case 'batch':
      return batchVerdict(rendering.calls.map((call) => callVerdict(call, state)))
    case 'typedData':
      if (!rendered(rendering.display)) return skipped('no descriptor renders this message')
      return rendering.attested ? PASSED : flagged(previewReason(rendering.attestationError, state))
  }
}

function callVerdict(call: Call, state: ClearSigning): Result {
  if (call.data === '0x') return PASSED
  if (call.to === null) return flagged('the transaction creates a contract, and nothing describes its code')
  if (rendered(call.display)) return call.attested ? PASSED : flagged(previewReason(call.attestationError, state))
  if (call.decoded) return skipped('no descriptor · the verified ABI decodes the call')
  return flagged('neither a descriptor nor the verified ABI decodes the call')
}

function batchVerdict(results: Result[]): Result {
  const warnings = results.flatMap((result, index) =>
    result.status === 'flagged' ? [`call ${index + 1} · ${result.reason}`] : [],
  )
  if (warnings.length > 0) return flagged(more(warnings[0], warnings.length))
  if (results.some(({ status }) => status === 'passed')) return PASSED
  return skipped(results[0]?.reason ?? 'no call')
}

// Why a descriptor showed as a preview.
function previewReason(error: string | null, { attesters }: ClearSigning): string {
  if (error) return `the attestation of the descriptor could not be checked · ${error}`
  if (attesters.length === 0) return 'the descriptor is a preview, since you trust no auditor yet'
  return 'no auditor you trust attested the descriptor'
}
