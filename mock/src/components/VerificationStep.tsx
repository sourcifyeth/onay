import { useState } from 'react'
import { getContractInfo, type MockContract, type MockRequest } from '../data/mockRequest'
import { BLOCKSCOUT, ETHERSCAN } from '../data/explorers'
import { localVerificationLog } from '../data/verificationLog'
import { CollapsibleLog } from './GateLog'
import { InfoTip, Step } from './Step'

interface Source {
  name: string
  verified: boolean
  url?: string
  note?: string
}

function sources(contract: MockContract, chainId: number): Source[] {
  const info = getContractInfo(contract.address)
  const etherscan = ETHERSCAN[chainId]
  const blockscout = BLOCKSCOUT[chainId]
  return [
    {
      name: 'Sourcify',
      verified: contract.matchType !== 'no match',
      url: `https://repo.sourcify.dev/${chainId}/${contract.address}`,
      note: contract.matchType !== 'no match' ? contract.matchType : undefined,
    },
    {
      name: 'Etherscan',
      verified: info?.explorers.etherscan ?? false,
      url: etherscan && `${etherscan}/address/${contract.address}#code`,
    },
    {
      name: 'Blockscout',
      verified: info?.explorers.blockscout ?? false,
      url: blockscout && `${blockscout}/address/${contract.address}?tab=contract`,
    },
  ]
}

function SourceRow({ source }: { source: Source }) {
  const status = source.verified ? (
    <span className="text-green-700">✓ verified</span>
  ) : (
    <span className="text-light-coral-700">✕ not verified</span>
  )
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800">{source.name}</p>
        {source.note && <p className="text-xs text-gray-500">{source.note}</p>}
      </div>
      <div className="flex shrink-0 items-baseline gap-3 text-sm">
        {status}
        {source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-cerulean-blue-600 hover:underline"
          >
            view ↗
          </a>
        )}
      </div>
    </div>
  )
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

function LocalVerification({ contract }: { contract: MockContract }) {
  const reproduced = contract.matchType !== 'no match'
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
          Local verification
          <InfoTip>
            {reproduced
              ? 'Onay does not take the results above on trust. It reproduces the verification on your machine: it downloads the source files from Sourcify, compiles them with the same compiler, and compares the result with the bytecode on chain.'
              : 'Onay reproduces verifications on your machine: it downloads the source files from Sourcify, compiles them, and compares the result with the bytecode on chain. This contract has no source files on Sourcify, so there is nothing to compile.'}
          </InfoTip>
        </span>
        {reproduced ? (
          <span className="text-sm text-green-700">✓ reproduced · {contract.matchType}</span>
        ) : (
          <span className="text-sm text-light-coral-700">✕ nothing to reproduce</span>
        )}
      </p>
      <CollapsibleLog lines={localVerificationLog(contract)} />
    </div>
  )
}

function SourceList({ list }: { list: Source[] }) {
  return (
    <div className="divide-y divide-gray-100">
      {list.map((s) => (
        <SourceRow key={s.name} source={s} />
      ))}
    </div>
  )
}

/** all three services agree: one summary line, the per-service rows open on demand */
function VerifiedEverywhere({ list }: { list: Source[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 py-1.5 text-left"
      >
        <span className="text-sm font-medium text-green-700">
          ✓ Verified everywhere
          <span className="pl-2 font-normal text-gray-500">
            {list.map((s) => s.name).join(', ')}
          </span>
        </span>
        <span className="shrink-0 text-gray-400">{open ? '▴' : '▾'}</span>
      </button>
      {open && <SourceList list={list} />}
    </div>
  )
}

function ContractVerification({ contract, chainId }: { contract: MockContract; chainId: number }) {
  const list = sources(contract, chainId)
  const nowhere = list.every((s) => !s.verified)
  const everywhere = list.every((s) => s.verified)
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      {nowhere && <BlackBoxWarning />}
      <p className="flex flex-wrap items-baseline gap-x-2 pb-2">
        <span className="text-xs text-gray-500">Contract</span>
        <span className="break-all font-mono text-[13px] text-gray-700">{contract.address}</span>
        <span className="text-xs text-gray-500">{contract.name}</span>
      </p>
      {everywhere ? <VerifiedEverywhere list={list} /> : <SourceList list={list} />}
      <LocalVerification contract={contract} />
    </div>
  )
}

export function VerificationStep({ request }: { request: MockRequest }) {
  // the contracts the request calls directly; deeper calls are in the call tree
  const targets = request.contracts.filter(
    (c, i, all) => c.depth === 0 && all.findIndex((o) => o.address === c.address) === i,
  )
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
          {targets.map((c) => (
            <ContractVerification key={c.address} contract={c} chainId={request.chainId} />
          ))}
        </div>
      )}
    </Step>
  )
}
