import { useRef, useState } from 'react'
import type { MockContract, MockRequest } from '../data/mockRequest'
import { Tabs } from './Tabs'
import { CodeView } from './CodeView'

function openInEditor() {
  alert('(mock) the verified sources would open in your editor')
}

function MatchBadge({ matchType }: { matchType: MockContract['matchType'] }) {
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
  chain: string
  expanded: boolean
  activeTab: number
  hasNext: boolean
  onToggle: () => void
  onTabChange: (tab: number) => void
  onNextFunction: () => void
}

function ContractCard({
  contract,
  chain,
  expanded,
  activeTab,
  hasNext,
  onToggle,
  onTabChange,
  onNextFunction,
}: ContractCardProps) {
  const calledFunction = (
    <div>
      <CodeView code={contract.functionSource} />
      <div className="mt-3 flex gap-3">
        <button
          onClick={openInEditor}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-cerulean-blue-400 hover:text-cerulean-blue-600"
        >
          Open in editor
        </button>
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
  )

  const sources = (
    <div>
      <button
        onClick={openInEditor}
        className="mb-2 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-cerulean-blue-400 hover:text-cerulean-blue-600"
      >
        Open files in your editor
      </button>
      <ul className="divide-y divide-gray-100">
        {contract.sources.map((file) => (
          <li key={file} className="py-1.5 font-mono text-xs text-gray-700">
            {file}
          </li>
        ))}
      </ul>
    </div>
  )

  const compilerSettings = (
    <dl className="divide-y divide-gray-100">
      {contract.compilerSettings.map((s) => (
        <div key={s.name} className="flex justify-between gap-4 py-1.5 font-mono text-xs">
          <dt className="text-gray-500">{s.name}</dt>
          <dd className="text-gray-800">{s.value}</dd>
        </div>
      ))}
    </dl>
  )

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left"
      >
        <div>
          <p className="font-mono text-sm font-medium text-gray-900">
            {contract.functionSignature.split('(')[0]}()
          </p>
          <p className="flex items-center gap-2 pt-1 text-xs text-gray-500">
            <span>{contract.name}</span>
            <MatchBadge matchType={contract.matchType} />
            <span className="font-mono text-gray-400">
              {chain} · {contract.address}
            </span>
          </p>
        </div>
        <span className="shrink-0 text-gray-400">{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && (
        <div className="px-5 pb-5">
          <Tabs
            active={activeTab}
            onChange={onTabChange}
            tabs={[
              { label: 'Called function', content: calledFunction },
              { label: 'Sources', content: sources },
              { label: 'Compiler settings', content: compilerSettings },
            ]}
          />
        </div>
      )}
    </section>
  )
}

export function ContractsSection({ request }: { request: MockRequest }) {
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const [tabs, setTabs] = useState<Record<number, number>>({})
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  const openNextFunction = (current: number) => {
    const next = current + 1
    setOpen((o) => ({ ...o, [current]: false, [next]: true }))
    setTabs((t) => ({ ...t, [next]: 0 }))
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
        Contracts · {request.contracts.length} involved
      </h2>
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
              chain={request.chain}
              expanded={open[i] ?? false}
              activeTab={tabs[i] ?? 0}
              hasNext={i < request.contracts.length - 1}
              onToggle={() => setOpen((o) => ({ ...o, [i]: !(o[i] ?? false) }))}
              onTabChange={(tab) => setTabs((t) => ({ ...t, [i]: tab }))}
              onNextFunction={() => openNextFunction(i)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
