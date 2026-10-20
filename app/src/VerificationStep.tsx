// Step 2 of the review: the source code of each contract. What Sourcify
// claims, and what the app reproduced.

import { useState } from 'react'
import { verdictOf, type Contract } from './gates/contracts.ts'
import { claimOf, claimText, describeCompiler, failureOf } from './gates/sourcify.ts'
import type { Verification } from './gates/verification.ts'
import { matchText } from './gates/verify.ts'
import { CollapsibleLog } from './Log.tsx'
import { InfoTip, Row, Step } from './Step.tsx'

// Coral for a contract that fails the request, amber for a flagged one.
function Warning({ title, amber = false, children }: { title: string; amber?: boolean; children: string }) {
  const colors = amber
    ? 'border-amber-400 bg-amber-50 text-amber-800'
    : 'border-light-coral-500 bg-light-coral-100 text-light-coral-700'
  return (
    <div className={`mb-3 rounded-lg border-2 px-4 py-4 ${colors}`}>
      <p className="text-lg font-semibold">⚠ {title}</p>
      <p className="pt-1 text-sm leading-relaxed text-gray-700">{children}</p>
    </div>
  )
}

function SourcifyRow({ contract }: { contract: Contract }) {
  const claim = claimOf(contract.sourcify)
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
  const claim = claimOf(state)
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
  const flagged = verdictOf(contract) === 'flagged'
  const name = claimOf(state)?.name ?? null
  const lines = verification.lines.filter(
    (line) => line.address === contract.address && (line.source === 'sourcify' || line.source === 'solc'),
  )
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      {flagged && (
        <Warning title="A called contract is not verified" amber>
          The transaction calls this contract, and Sourcify has no source code for it. What it does cannot be checked
          here. Only go on if you know the contract.
        </Warning>
      )}
      {failure?.kind === 'not verified' && !flagged && (
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
        <span className="text-xs text-gray-500">{roleOf(contract)}</span>
        <span className="font-mono text-[13px] break-all text-gray-700">{contract.address}</span>
        {name && <span className="text-xs text-gray-500">{name}</span>}
      </p>
      <SourcifyRow contract={contract} />
      <LocalVerification contract={contract} />
      <CollapsibleLog lines={lines} />
    </div>
  )
}

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

function roleOf(contract: Contract): string {
  if (contract.implementationOf) return `Implementation of ${short(contract.implementationOf)}`
  return contract.foundBy === 'request' ? 'Contract' : 'Called contract'
}

// The contracts that the simulation found, folded. The header counts
// them, and says how many are not verified.
function CalledContracts({ contracts, verification }: { contracts: Contract[]; verification: Verification }) {
  const [open, setOpen] = useState(false)
  const flagged = contracts.filter((contract) => verdictOf(contract) === 'flagged').length
  const failed = contracts.filter((contract) => verdictOf(contract) === 'failed').length
  const count = `${contracts.length} ${contracts.length === 1 ? 'contract' : 'contracts'} called on the way`
  const note = failed > 0 ? ` · ${failed} failed` : flagged > 0 ? ` · ${flagged} not verified` : ' · all verified'
  const color = failed > 0 ? 'text-light-coral-700' : flagged > 0 ? 'text-amber-700' : 'text-green-700'
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left"
      >
        <span className={`text-sm font-medium ${color}`}>
          {failed > 0 ? '✕ ' : flagged > 0 ? '⚠ ' : '✓ '}
          {count}
          {note}
        </span>
        <span className="shrink-0 text-gray-400">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {contracts.map((contract) => (
            <ContractVerification key={contract.address} contract={contract} verification={verification} />
          ))}
        </div>
      )}
    </div>
  )
}

export function VerificationStep({ verification }: { verification: Verification }) {
  // A contract with code. The Sourcify gate skips the others.
  const targets = verification.contracts.filter((contract) => contract.sourcify.status !== 'skipped')
  const named = targets.filter((contract) => contract.foundBy === 'request')
  const called = targets.filter((contract) => contract.foundBy === 'simulation')
  return (
    <Step
      number={3}
      title="Source Code Verification"
      explainer="A contract without verified source code is a black box: nobody can check what it does. Do not interact with one. The contracts that the transaction calls on the way are checked too."
    >
      {targets.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600 shadow-sm">
          The recipient is not a contract, so there is no code to verify.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {named.map((contract) => (
            <ContractVerification key={contract.address} contract={contract} verification={verification} />
          ))}
          {called.length > 0 && <CalledContracts contracts={called} verification={verification} />}
        </div>
      )}
    </Step>
  )
}
