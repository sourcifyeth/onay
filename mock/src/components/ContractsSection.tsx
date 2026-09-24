import { useRef, useState } from 'react'
import type { MockContract, MockRequest } from '../data/mockRequest'
import { CodeView } from './CodeView'

function openInEditor() {
  alert('(mock) the verified sources would open in your editor')
}

const actionBtn =
  'rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-cerulean-blue-400 hover:text-cerulean-blue-600'

function MatchBadge({ matchType }: { matchType: MockContract['matchType'] }) {
  if (matchType === 'no match') {
    return (
      <span className="rounded-full bg-light-coral-100 px-2 py-0.5 font-mono text-xs text-light-coral-700">
        ✕ no match
      </span>
    )
  }
  const exact = matchType === 'exact match'
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-mono text-xs ${
        exact ? 'bg-green-50 text-green-700' : 'bg-cerulean-blue-100 text-cerulean-blue-700'
      }`}
    >
      ✓ {matchType}
    </span>
  )
}

interface ContractCardProps {
  contract: MockContract
  chainId: number
  selector?: string
  expanded: boolean
  hasNext: boolean
  onToggle: () => void
  onNextFunction: () => void
}

function ContractCard({
  contract,
  chainId,
  selector,
  expanded,
  hasNext,
  onToggle,
  onNextFunction,
}: ContractCardProps) {
  const verified = contract.matchType !== 'no match'

  const body = verified ? (
    <div>
      <CodeView code={contract.functionSource} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={openInEditor} className={actionBtn}>
          Open in editor
        </button>
        <a
          href={`https://repo.sourcify.dev/${chainId}/${contract.address}`}
          target="_blank"
          rel="noreferrer"
          className={actionBtn}
        >
          View on Sourcify ↗
        </a>
        {hasNext && (
          <button
            onClick={onNextFunction}
            className="rounded-lg border border-cerulean-blue-300 px-3 py-1.5 text-xs font-medium text-cerulean-blue-600 hover:bg-cerulean-blue-100"
          >
            Next called function ↓
          </button>
        )}
      </div>
    </div>
  ) : (
    <div>
      <p className="rounded-lg border-l-2 border-light-coral-500 bg-light-coral-100 px-3 py-2 text-xs leading-relaxed text-gray-700">
        No verified source for this contract on Sourcify. There is nothing to review: the function
        name above comes from the public signature database and only matches the selector, it is not
        proof of what the code does.
      </p>
      {selector && (
        <div className="mt-3">
          <a
            href={`https://4byte.sourcify.dev/?q=${selector}`}
            target="_blank"
            rel="noreferrer"
            className={actionBtn}
          >
            Look up selector {selector} ↗
          </a>
        </div>
      )}
    </div>
  )

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left"
      >
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-xs text-gray-500">Contract</span>
            <span className="break-all font-mono text-[13px] text-gray-700">{contract.address}</span>
            <span className="text-xs text-gray-500">{contract.name}</span>
            <MatchBadge matchType={contract.matchType} />
          </p>
          <p className="pt-1 font-mono text-sm font-medium text-gray-900">
            {contract.functionSignature.includes('(')
              ? `${contract.functionSignature.split('(')[0]}()`
              : contract.functionSignature}
          </p>
        </div>
        <span className="shrink-0 text-gray-400">{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && <div className="px-5 pb-5">{body}</div>}
    </section>
  )
}

export function ContractsSection({ request }: { request: MockRequest }) {
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  const openNextFunction = (current: number) => {
    const next = current + 1
    setOpen((o) => ({ ...o, [current]: false, [next]: true }))
    setTimeout(() => {
      cardRefs.current[next]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }

  const contracts = request.contracts
  // a child is the last of its siblings when no later node sits at the same
  // depth before the tree returns to a shallower level
  const isLastChild = (i: number) => {
    for (let j = i + 1; j < contracts.length; j++) {
      if (contracts[j].depth < contracts[i].depth) return true
      if (contracts[j].depth === contracts[i].depth) return false
    }
    return true
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-mono text-xs uppercase tracking-widest text-gray-500">
        Call tree · {contracts.length === 0 ? 'none' : contracts.length}
      </h2>
      {contracts.length === 0 && (
        <p className="rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600 shadow-sm">
          The recipient is not a contract: this is a plain ETH transfer to an externally owned
          account, with no code involved.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {contracts.map((contract, i) => (
          <div
            key={contract.address}
            ref={(el) => {
              cardRefs.current[i] = el
            }}
            className="relative scroll-mt-4"
            style={{ marginLeft: contract.depth * 24 }}
          >
            {contract.depth > 0 && (
              <>
                <span
                  className="absolute left-[-14px] w-px bg-cerulean-blue-200"
                  style={{ top: -8, height: isLastChild(i) ? 32 : 'calc(100% + 8px)' }}
                />
                <span className="absolute left-[-14px] top-[24px] h-px w-[11px] bg-cerulean-blue-200" />
                <span className="absolute left-[-5px] top-[22px] h-[5px] w-[5px] rounded-full bg-cerulean-blue-400" />
              </>
            )}
            <ContractCard
              contract={contract}
              chainId={request.chainId}
              selector={request.decoded?.selector}
              expanded={open[i] ?? false}
              hasNext={i < contracts.length - 1}
              onToggle={() => setOpen((o) => ({ ...o, [i]: !(o[i] ?? false) }))}
              onNextFunction={() => openNextFunction(i)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
