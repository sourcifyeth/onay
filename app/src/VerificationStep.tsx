// Step 2 of the review: the source code of each contract. What Sourcify
// claims, and what the app reproduced.

import type { Contract } from './gates/contracts.ts'
import { ThirdPartyIcon } from './Icons.tsx'
import { claimText, describeCompiler, failureOf, type Found } from './gates/sourcify.ts'
import type { Verification } from './gates/verification.ts'
import { matchText } from './gates/verify.ts'
import { CollapsibleLog } from './Log.tsx'
import { InfoTip, Row, Step } from './Step.tsx'

function Warning({ title, children }: { title: string; children: string }) {
  return (
    <div className="mb-3 rounded-lg border-2 border-light-coral-500 bg-light-coral-100 px-4 py-4">
      <p className="text-lg font-semibold text-light-coral-700">⚠ {title}</p>
      <p className="pt-1 text-sm leading-relaxed text-gray-700">{children}</p>
    </div>
  )
}

// What Sourcify claims, from a passed gate or from a failure that kept it.
function claimOf(contract: Contract): Found | null {
  const state = contract.sourcify
  if (state.status === 'passed') return state.value.claim
  const failure = failureOf(state)
  return failure?.kind === 'not reproduced' ? failure.claim : null
}

function SourcifyRow({ contract }: { contract: Contract }) {
  const claim = claimOf(contract)
  const notFound = failureOf(contract.sourcify)?.kind === 'not verified'
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800">Sourcify</p>
        {claim && <p className="text-xs text-gray-500">claims {claimText(claim.runtimeMatch)}</p>}
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

const HOW =
  'Onay does not take the result above on trust. It reproduces the verification on your machine: it downloads the source files from Sourcify, compiles them with the same compiler, and compares the result with the bytecode on chain.'

function LocalVerification({ contract }: { contract: Contract }) {
  const state = contract.sourcify
  const failure = failureOf(state)
  const claim = claimOf(contract)
  let result
  let tip = HOW
  if (state.status === 'passed') {
    result = <span className="text-sm text-green-700">✓ reproduced</span>
  } else if (failure?.kind === 'not verified') {
    result = <span className="text-sm text-light-coral-700">✕ nothing to reproduce</span>
    tip = `${HOW} This contract has no source files on Sourcify, so there is nothing to compile.`
  } else if (failure?.kind === 'not reproduced') {
    result = <span className="text-sm text-light-coral-700">✕ not reproduced</span>
    tip = `${HOW} Here the result is not the bytecode on chain: either Sourcify is wrong, or the code at the address is not the one it verified.`
  } else if (state.status === 'failed') {
    result = <span className="text-sm text-light-coral-700">✕ {state.reason}</span>
  } else {
    result = <span className="text-sm text-gray-400">not run</span>
  }
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
          Local verification
          <InfoTip>{tip}</InfoTip>
        </span>
        {result}
      </p>
      {(state.status === 'passed' || claim) && (
        <div className="divide-y divide-gray-100">
          <Row label="Runtime bytecode">
            {state.status === 'passed' ? (
              <span className="text-sm text-green-700">✓ {matchText(state.value.runtimeMatch)}</span>
            ) : (
              <span className="text-sm text-light-coral-700">✕ not the code on chain</span>
            )}
          </Row>
          {state.status === 'passed' && (
            <Row label="Creation bytecode">
              {state.value.creationMatch ? (
                <span className="text-sm text-green-700">
                  ✓ {matchText(state.value.creationMatch)}
                  {state.value.creationNote && <span className="text-gray-500"> · {state.value.creationNote}</span>}
                </span>
              ) : (
                <span className="text-sm text-gray-500">not compared · {state.value.creationNote}</span>
              )}
            </Row>
          )}
          {claim && (
            <>
              <Row label="Compiler">
                <span className="font-mono text-[13px]">{describeCompiler(claim)}</span>
              </Row>
              <Row label="Sources">
                <span className="font-mono text-[13px] break-all">
                  {Object.keys(claim.stdJsonInput.sources).join(', ')}
                </span>
              </Row>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ContractVerification({ contract, verification }: { contract: Contract; verification: Verification }) {
  const state = contract.sourcify
  const failure = failureOf(state)
  const name = claimOf(contract)?.name ?? null
  const lines = verification.lines.filter(
    (line) => line.address === contract.address && (line.source === 'sourcify' || line.source === 'solc'),
  )
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      {failure?.kind === 'not verified' && (
        <Warning title="Source code is not verified">
          Nobody can read what this contract does. It is a black box. Do not interact with it.
        </Warning>
      )}
      {failure?.kind === 'not reproduced' && (
        <Warning title="Source code does not match the chain">
          Sourcify claims these sources, but compiled on your machine they do not give the code at this address. Do not
          trust the sources, and do not interact with it.
        </Warning>
      )}
      {state.status === 'failed' && !failure && (
        <Warning title="Source code not checked">
          The check did not finish, so nothing is known about this contract. Do not interact with it.
        </Warning>
      )}
      <p className="flex flex-wrap items-baseline gap-x-2 pb-2">
        <span className="text-xs text-gray-500">Contract</span>
        <span className="font-mono text-[13px] break-all text-gray-700">{contract.address}</span>
        {name && <span className="text-xs text-gray-500">{name}</span>}
      </p>
      {contract.via && (
        <p className="flex items-center gap-1.5 pb-2 text-xs text-gray-500">
          <ThirdPartyIcon className="h-3.5 w-3.5 shrink-0" title="From a third party, not checked here" />
          <span>
            implementation of the proxy <span className="font-mono text-gray-700">{contract.via}</span>, as Sourcify
            claims. The code here is verified; that the proxy uses it is not.
          </span>
        </p>
      )}
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
