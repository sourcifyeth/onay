// Step 3 of the review: the source code of each contract. What Sourcify
// claims, and what the app reproduced.

import { useState } from 'react'
import { verdictOf, type Contract, type Verdict } from './gates/contracts.ts'
import { delegateOf } from './gates/simulation.ts'
import { claimOf, claimText, describeCompiler, failureOf, type Found } from './gates/sourcify.ts'
import type { Verification } from './gates/verification.ts'
import { matchText, WITHOUT_PROOF } from './gates/verify.ts'
import { short } from './gates/words.ts'
import { ThirdPartyIcon } from './Icons.tsx'
import { CollapsibleLog } from './Log.tsx'
import { CollapsibleCard, InfoTip, Notice, Row, Step } from './Step.tsx'

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

// A path that wraps only at its slashes: a zero-width space after each
// one gives the browser a place to break the line.
const breakable = (path: string) => path.split('/').join('/\u200b')

// The count and the main file. The full list, which a large contract
// repeats under several roots, opens on demand.
function SourcesRow({ claim }: { claim: Found }) {
  const [open, setOpen] = useState(false)
  const files = Object.keys(claim.stdJsonInput.sources)
  return (
    <Row label="Sources">
      <span className="font-mono text-[13px]">
        {files.length} {files.length === 1 ? 'file' : 'files'} · {breakable(claim.path)}
      </span>
      {files.length > 1 && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="ml-2 font-mono text-xs text-gray-400 transition-colors hover:text-gray-600"
        >
          {open ? 'hide ▴' : 'all ▾'}
        </button>
      )}
      {open && (
        <ul className="mt-1 text-left font-mono text-xs leading-relaxed text-gray-500">
          {files.map((file) => (
            <li key={file}>{breakable(file)}</li>
          ))}
        </ul>
      )}
    </Row>
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
                  {/* The same icon as the log line: the transaction came from an endpoint. */}
                  {state.value.creationNote === WITHOUT_PROOF ? (
                    <ThirdPartyIcon className="ml-1.5 inline-block h-3.5 w-3.5 align-[-2px]" title={WITHOUT_PROOF} />
                  ) : (
                    state.value.creationNote && <span className="text-gray-500"> · {state.value.creationNote}</span>
                  )}
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
              <SourcesRow claim={claim} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

// The role of a contract. Code that ran in the context of a named
// contract is its proxy implementation only when Sourcify's proxy
// detection, a claim, names it so; otherwise it may be the facet of a
// diamond or a library, and the role says what the simulation saw.
function roleOf(contract: Contract, contracts: Contract[]): string {
  const of = contract.implementationOf
  if (!of) return contract.foundBy === 'request' ? 'Contract' : 'Called contract'
  const named = contracts.find((other) => other.address === of)
  if (named && delegateOf(codeOf(named) ?? '0x')) return `Delegate of ${short(of)}`
  const claim = named ? claimOf(named.sourcify) : null
  const confirmed = claim?.implementations.some((impl) => impl.address === contract.address) ?? false
  if (confirmed && claim) return `Implementation of ${short(of)} · ${claim.proxyType} proxy per Sourcify`
  return `Ran as ${short(of)}`
}

const MARKS: Record<Verdict, [string, string]> = {
  pending: ['…', 'text-gray-400'],
  passed: ['✓', 'text-green-700'],
  flagged: ['⚠', 'text-amber-700'],
  failed: ['✕', 'text-light-coral-700'],
}

// One line per contract: its verdict, role, address and name.
function ContractSummary({ contract, contracts }: { contract: Contract; contracts: Contract[] }) {
  const [mark, color] = MARKS[verdictOf(contract)]
  const name = claimOf(contract.sourcify)?.name
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className={`font-medium ${color}`}>{mark}</span>
      <span className="text-xs text-gray-500">{roleOf(contract, contracts)}</span>
      <span className="font-mono text-[13px] text-gray-700" title={contract.address}>
        {short(contract.address)}
      </span>
      {name && <span className="font-medium text-gray-800">{name}</span>}
    </p>
  )
}

function Warnings({ contract }: { contract: Contract }) {
  const state = contract.sourcify
  const failure = failureOf(state)
  const flagged = verdictOf(contract) === 'flagged'
  return (
    <>
      {flagged && (
        <Notice tone="amber" title="⚠ A called contract is not verified" className="mb-3">
          The transaction calls this contract, and Sourcify has no source code for it. What it does cannot be checked
          here. Only go on if you know the contract.
        </Notice>
      )}
      {failure?.kind === 'not verified' && !flagged && (
        <Notice tone="coral" title="⚠ Source code is not verified" className="mb-3">
          Nobody can read what this contract does. It is a black box. Do not interact with it.
        </Notice>
      )}
      {failure?.kind === 'not reproduced' && (
        <Notice tone="coral" title="⚠ Source code does not match the chain" className="mb-3">
          Sourcify claims these sources, but compiled on your machine they do not give the code at this address. Do not
          trust the sources, and do not interact with it.
        </Notice>
      )}
      {((state.status === 'failed' && !failure) || state.status === 'skipped') && (
        <Notice tone="coral" title="⚠ Source code not checked" className="mb-3">
          {`${state.reason}. Nothing is known about this contract. Do not interact with it.`}
        </Notice>
      )}
    </>
  )
}

// The code of a contract, if the chain gate read it.
const codeOf = (contract: Contract) => (contract.helios.status === 'passed' ? contract.helios.value.code : null)

// An account with a delegate (EIP-7702). The code of the delegate runs,
// so the delegate has the card, right below.
function DelegatedAccount({ contract }: { contract: Contract }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm shadow-sm">
      <span className="text-xs text-gray-500">EIP-7702 account</span>
      <span className="font-mono text-[13px] text-gray-700" title={contract.address}>
        {short(contract.address)}
      </span>
      <span className="text-gray-500">· delegate checked below</span>
    </p>
  )
}

// The entry of a contract in the list: the one-line box for an account
// with a delegate, the full card for every other one.
function ContractEntry({
  contract,
  verification,
  open,
}: {
  contract: Contract
  verification: Verification
  open: boolean
}) {
  if (contract.sourcify.status === 'skipped' && delegateOf(codeOf(contract) ?? '0x')) {
    return <DelegatedAccount contract={contract} />
  }
  return <ContractVerification contract={contract} verification={verification} open={open} />
}

// The full card of a contract, behind its summary line.
function ContractVerification({
  contract,
  verification,
  open,
}: {
  contract: Contract
  verification: Verification
  open: boolean
}) {
  const lines = verification.lines.filter(
    (line) => line.address === contract.address && (line.source === 'sourcify' || line.source === 'solc'),
  )
  return (
    <CollapsibleCard open={open} summary={<ContractSummary contract={contract} contracts={verification.contracts} />}>
      <Warnings contract={contract} />
      <p className="pb-2 font-mono text-[13px] break-all text-gray-700">{contract.address}</p>
      <SourcifyRow contract={contract} />
      <LocalVerification contract={contract} />
      <CollapsibleLog lines={lines} />
    </CollapsibleCard>
  )
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
            <ContractEntry key={contract.address} contract={contract} verification={verification} open={false} />
          ))}
        </div>
      )}
    </div>
  )
}

export function VerificationStep({ verification }: { verification: Verification }) {
  // An address without code has nothing to verify, and is left out. An
  // account with a delegate (EIP-7702) has no sources either, but it
  // stays: it is what the request names, and its delegate is checked.
  const targets = verification.contracts.filter((contract) => codeOf(contract) !== '0x')
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
          {/* The contracts the request names open. Their implementations wait behind their line. */}
          {named.map((contract) => (
            <ContractEntry
              key={contract.address}
              contract={contract}
              verification={verification}
              open={!contract.implementationOf}
            />
          ))}
          {called.length > 0 && <CalledContracts contracts={called} verification={verification} />}
        </div>
      )}
    </Step>
  )
}
