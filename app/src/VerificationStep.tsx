// Step 2 of the review: the source code of each contract. What Sourcify
// claims, and what the app reproduced.

import type { Contract } from './gates/contracts.ts'
import { describeCompiler, type MatchStatus } from './gates/sourcify.ts'
import type { Verification } from './gates/verification.ts'
import type { Match } from './gates/verify.ts'
import { CollapsibleLog } from './Log.tsx'
import { InfoTip, Row, Step } from './Step.tsx'

const NOT_ON_SOURCIFY = /not verified on Sourcify/

function matchText(status: MatchStatus): string {
  return status === null ? 'no match' : status.replace('_', ' ')
}

function matchKind(match: Match): string {
  return match === 'perfect' ? 'exact match' : 'match · the metadata hash differs'
}

function BlackBoxWarning() {
  return (
    <div className="mb-3 rounded-lg border-2 border-light-coral-500 bg-light-coral-100 px-4 py-4">
      <p className="text-lg font-semibold text-light-coral-700">⚠ Source code is not verified</p>
      <p className="pt-1 text-sm leading-relaxed text-gray-700">
        Nobody can read what this contract does. It is a black box. Do not interact with it.
      </p>
    </div>
  )
}

function SourcifyRow({ contract }: { contract: Contract }) {
  const state = contract.sourcify
  const claim = state.status === 'passed' ? state.value.claim : null
  const notFound = state.status === 'failed' && NOT_ON_SOURCIFY.test(state.reason)
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800">Sourcify</p>
        {claim && <p className="text-xs text-gray-500">claims {matchText(claim.runtimeMatch)}</p>}
      </div>
      <span className="shrink-0 text-sm">
        {claim ? (
          <span className="text-green-700">✓ verified</span>
        ) : notFound ? (
          <span className="text-light-coral-700">✕ not verified</span>
        ) : (
          <span className="text-gray-400">unknown</span>
        )}
      </span>
    </div>
  )
}

function LocalVerification({ contract }: { contract: Contract }) {
  const state = contract.sourcify
  const reproduced = state.status === 'passed'
  let result
  if (state.status === 'passed') {
    result = <span className="text-sm text-green-700">✓ reproduced</span>
  } else if (state.status === 'failed') {
    result = (
      <span className="text-sm text-light-coral-700">
        ✕ {NOT_ON_SOURCIFY.test(state.reason) ? 'nothing to reproduce' : state.reason}
      </span>
    )
  } else {
    result = <span className="text-sm text-gray-400">not run</span>
  }
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
          Local verification
          <InfoTip>
            {reproduced
              ? 'Onay does not take the result above on trust. It reproduces the verification on your machine: it downloads the source files from Sourcify, compiles them with the same compiler, and compares the result with the bytecode on chain.'
              : 'Onay reproduces verifications on your machine: it downloads the source files from Sourcify, compiles them, and compares the result with the bytecode on chain. This contract has no source files on Sourcify, so there is nothing to compile.'}
          </InfoTip>
        </span>
        {result}
      </p>
      {state.status === 'passed' && (
        <div className="divide-y divide-gray-100">
          <Row label="Runtime bytecode">
            <span className="text-sm text-green-700">✓ {matchKind(state.value.runtimeMatch)}</span>
          </Row>
          <Row label="Creation bytecode">
            {state.value.creationMatch ? (
              <span className="text-sm text-green-700">
                ✓ {matchKind(state.value.creationMatch)}
                {state.value.creationNote && <span className="text-gray-500"> · {state.value.creationNote}</span>}
              </span>
            ) : (
              <span className="text-sm text-gray-500">not compared · {state.value.creationNote}</span>
            )}
          </Row>
          <Row label="Compiler">
            <span className="font-mono text-[13px]">{describeCompiler(state.value.claim)}</span>
          </Row>
          <Row label="Sources">
            <span className="font-mono text-[13px] break-all">
              {Object.keys(state.value.claim.stdJsonInput.sources).join(', ')}
            </span>
          </Row>
        </div>
      )}
    </div>
  )
}

function ContractVerification({ contract, verification }: { contract: Contract; verification: Verification }) {
  const state = contract.sourcify
  const name = state.status === 'passed' ? state.value.claim.name : null
  const lines = verification.lines.filter(
    (line) => line.address === contract.address && (line.source === 'sourcify' || line.source === 'solc'),
  )
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      {state.status === 'failed' && NOT_ON_SOURCIFY.test(state.reason) && <BlackBoxWarning />}
      <p className="flex flex-wrap items-baseline gap-x-2 pb-2">
        <span className="text-xs text-gray-500">Contract</span>
        <span className="font-mono text-[13px] break-all text-gray-700">{contract.address}</span>
        {name && <span className="text-xs text-gray-500">{name}</span>}
      </p>
      <SourcifyRow contract={contract} />
      <LocalVerification contract={contract} />
      <CollapsibleLog lines={lines} />
    </div>
  )
}

export function VerificationStep({ verification }: { verification: Verification }) {
  // A contract with code. The Sourcify gate skips the others.
  const targets = verification.contracts.filter((contract) => contract.sourcify.status !== 'skipped')
  return (
    <Step
      number={2}
      title="Source Code Verification"
      explainer="A contract without verified source code is a black box: nobody can check what it does. Do not interact with one."
    >
      {targets.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600 shadow-sm">
          The recipient is not a contract, so there is no code to verify.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {targets.map((contract) => (
            <ContractVerification key={contract.address} contract={contract} verification={verification} />
          ))}
        </div>
      )}
    </Step>
  )
}
