// Step 2 of the review: the calls of the request, run on the state of
// the chain. The call tree shows every contract on the way.

import { Fragment } from 'react'
import type { Contract } from './gates/contracts.ts'
import type { GateState } from './gates/gate.ts'
import { claimOf } from './gates/sourcify.ts'
import { reverted, UNKNOWN, type Frame, type Simulation } from './gates/simulation.ts'
import type { Verification } from './gates/verification.ts'
import { count, formatEther, short } from './gates/words.ts'
import { CollapsibleLog } from './Log.tsx'
import { CollapsibleCard, Notice, Row, Step } from './Step.tsx'

function Summary({ state, helios, runs }: { state: GateState<Simulation>; helios: boolean; runs: boolean }) {
  if (state.status === 'skipped') {
    if (!runs) return <Notice tone="gray" title={`Not simulated · ${state.reason}`} />
    return (
      <Notice tone="amber" title="⚠ The transaction was not simulated">
        {`${state.reason}. The contracts it calls on the way are unknown.`}
      </Notice>
    )
  }
  if (state.status === 'failed') {
    return (
      <Notice tone="coral" title="⚠ The transaction could not be simulated">
        {`${state.reason}. The contracts that the transaction calls on the way are unknown.`}
      </Notice>
    )
  }
  if (state.status !== 'passed') return <Notice tone="gray" title="Simulation is running" />
  const failed = state.value.calls.find((call) => call.error)
  if (failed) {
    return (
      <Notice tone="coral" title="⚠ The transaction reverts in simulation" detail={failed.error ?? undefined}>
        {`Run on the ${helios ? 'latest verified' : 'latest'} chain state. Sending it would only waste gas. Do not sign it.`}
      </Notice>
    )
  }
  const touched = state.value.touched.length
  return (
    <p className="text-sm font-medium text-green-700">
      ✓ Simulated on {helios ? 'verified' : 'unverified'} chain state · {touched}{' '}
      {touched === 1 ? 'contract' : 'contracts'} touched
    </p>
  )
}

function FrameRow({ frame, contracts }: { frame: Frame; contracts: Contract[] }) {
  const contract = contracts.find((candidate) => candidate.address === frame.address)
  const name = contract ? claimOf(contract.sourcify)?.name : undefined
  // A create that failed never got its address.
  const known = frame.kind !== 'create' || frame.address !== UNKNOWN
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 py-1 text-[13px]" style={{ paddingLeft: frame.depth * 20 }}>
      <span className="font-mono text-xs text-gray-400">{frame.kind}</span>
      {known && (
        <span className="font-mono break-all text-gray-700" title={frame.address}>
          {short(frame.address)}
        </span>
      )}
      {name && <span className="text-xs text-gray-500">{name}</span>}
      {frame.selector && <span className="font-mono text-xs text-gray-400">{frame.selector}</span>}
      {frame.value > 0n && <span className="text-xs text-gray-500">{formatEther(frame.value)} ETH</span>}
      {frame.error && <span className="text-xs text-light-coral-700">✕ {frame.error}</span>}
    </div>
  )
}

function CallTree({ simulation, contracts }: { simulation: Simulation; contracts: Contract[] }) {
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="text-sm font-medium text-gray-800">Call tree</p>
      {simulation.calls.map((call, index) => (
        <Fragment key={index}>
          {simulation.calls.length > 1 && (
            <p className="pt-2 text-xs text-gray-500">
              call {index + 1} of {simulation.calls.length}
            </p>
          )}
          {call.frames.map((frame, at) => (
            <FrameRow key={at} frame={frame} contracts={contracts} />
          ))}
        </Fragment>
      ))}
    </div>
  )
}

export function SimulationStep({ verification }: { verification: Verification }) {
  const { simulation, contracts, chain } = verification
  const helios = chain?.mode === 'helios'
  const lines = verification.lines.filter((line) => line.source === 'evm')
  const proof = helios ? (
    <span className="text-green-700"> ✓ merkle proofs</span>
  ) : (
    <span className="text-amber-700"> no proof</span>
  )
  // A revert is the case where the tree matters most: the failing frame
  // says where.
  const open = simulation.status === 'passed' && reverted(simulation.value)
  return (
    <Step
      number={2}
      title="Transaction Simulation"
      explainer="Onay runs the transaction in a local EVM on the chain state it read in step 1. The result shows every contract the transaction calls, not only the one it names, so that step 3 can check each of them."
    >
      <CollapsibleCard open={open} summary={<Summary state={simulation} helios={helios} runs={verification.runs} />}>
        {simulation.status === 'passed' && (
          <>
            <div className="divide-y divide-gray-100">
              <Row label="Block">{simulation.value.header.number.toLocaleString('en-US')}</Row>
              <Row label="State read">
                {count(simulation.value.reads.accounts, 'account')} ·{' '}
                {count(simulation.value.reads.slots, 'storage slot')}
                {proof}
              </Row>
            </div>
            <CallTree simulation={simulation.value} contracts={contracts} />
          </>
        )}
        <CollapsibleLog lines={lines} />
      </CollapsibleCard>
    </Step>
  )
}
