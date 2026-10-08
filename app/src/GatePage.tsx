import { Fragment, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { SigningRequest } from './messages.ts'
import { chainName } from './chains.ts'
import { LocallyVerifiedIcon, ThirdPartyIcon } from './Icons.tsx'
import type { GateState } from './gates/gate.ts'
import { verificationFor, type TimedLine, type Verification } from './gates/verification.ts'

// The log shows at most one new line in this time, so that you can read it.
// The stamps show the real time of each line.
const LINE_PACE = 200

function Headline({ request }: { request: SigningRequest }) {
  const site = (
    <>
      Website <span className="text-cerulean-blue-600">{request.origin}</span>
    </>
  )
  switch (request.method) {
    case 'eth_sendTransaction':
      return <>{site} created a transaction for you to sign and execute</>
    case 'eth_signTransaction':
      return <>{site} created a transaction for you to sign</>
    case 'wallet_sendCalls':
      return <>{site} created a batch of transactions for you to sign and execute</>
    default:
      return <>{site} created a message for you to sign</>
  }
}

// One badge in joined parts: chain id, chain name, and the address.
function ChainBadge({ chainId, address }: { chainId: number | null; address?: string }) {
  return (
    <p>
      <span className="inline-flex max-w-full overflow-hidden rounded-md border border-cerulean-blue-200 text-sm">
        <span title="Chain id" className="shrink-0 bg-cerulean-blue-500 px-2 py-0.5 font-mono text-white">
          {chainId ?? '?'}
        </span>
        <span className="shrink-0 bg-white px-2.5 py-0.5 text-gray-700">
          {chainId === null ? 'unknown chain' : chainName(chainId)}
        </span>
        {address && (
          <span className="min-w-0 border-l border-cerulean-blue-200 bg-gray-50 px-2.5 py-0.5 font-mono break-all text-gray-900">
            {address}
          </span>
        )}
      </span>
    </p>
  )
}

function Summary({ request, verification }: { request: SigningRequest; verification: Verification }) {
  const { contracts, chainId } = verification
  const label = request.method.startsWith('eth_signTypedData') ? 'Verifying contract' : 'To'
  return (
    <section className="animate-fade-up">
      <p className="text-base font-medium text-gray-900">
        <Headline request={request} />
      </p>
      <p className="pt-1 text-sm text-gray-500">
        Your wallet has the same request now. Check it here before you confirm there.
      </p>
      {contracts.length === 0 ? (
        chainId !== null && (
          <div className="pt-5">
            <ChainBadge chainId={chainId} />
          </div>
        )
      ) : (
        <div className="grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-1 pt-5">
          {contracts.map((contract, index) => (
            <Fragment key={contract.address}>
              <span className="text-xs text-gray-500">{index === 0 ? label : ''}</span>
              <ChainBadge chainId={chainId} address={contract.address} />
            </Fragment>
          ))}
        </div>
      )}
    </section>
  )
}

function LogLineView({ line, tag = false }: { line: TimedLine; tag?: boolean }) {
  return (
    <p className="break-all">
      <span className="whitespace-pre text-gray-300">[{(line.at / 1000).toFixed(6).padStart(10)}] </span>
      {tag && <span className="text-gray-400">{line.source} </span>}
      <span className="text-gray-500">{line.text}</span>
      {line.ok === true && <span className="text-green-600"> ✓</span>}
      {line.ok === false && <span className="text-light-coral-700"> ✕</span>}
    </p>
  )
}

function Cursor() {
  return <span className="animate-pulse text-cerulean-blue-500">▍</span>
}

// The lines of one gate under its header.
function Section({
  title,
  color,
  icon,
  subtitle,
  lines,
  state,
}: {
  title: string
  color: string
  icon: ReactNode
  subtitle: string
  lines: TimedLine[]
  state: 'running' | 'passed' | 'failed'
}) {
  const dot = { running: 'bg-yellow-400', passed: 'bg-green-600', failed: 'bg-light-coral-600' }[state]
  return (
    <section className="pt-3">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          {state === 'running' && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-300 opacity-75" />
          )}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
        </span>
        <span className={color}>{title}</span>
        {icon}
        <span className="truncate text-gray-500">· {subtitle}</span>
      </div>
      <div className="pt-1 pl-4">
        {lines.map((line, index) => (
          <LogLineView key={index} line={line} />
        ))}
        {state === 'running' && <Cursor />}
      </div>
    </section>
  )
}

// The state of one gate over each contract.
function gateStatus(states: GateState<unknown>[]): 'running' | 'passed' | 'failed' {
  if (states.some(({ status }) => status === 'failed')) return 'failed'
  if (states.every(({ status }) => status === 'passed' || status === 'skipped')) return 'passed'
  return 'running'
}

function GateLog({ verification, shown, done }: { verification: Verification; shown: number; done: boolean }) {
  const { contracts, chainId, mode, status } = verification
  const visible = verification.lines.slice(0, shown)
  const browser = visible.filter((line) => line.source === 'browser')
  const sourcify = visible.filter((line) => line.source === 'sourcify')
  const chain = visible.filter((line) => line.source === mode)
  const target = contracts.length === 1 ? contracts[0].address : `${contracts.length} contracts`
  const thirdParty = <ThirdPartyIcon className="h-3.5 w-3.5 shrink-0" title="From a third party, not verified" />
  return (
    <div className="font-mono text-xs leading-relaxed">
      {browser.map((line, index) => (
        <LogLineView key={index} line={line} tag />
      ))}
      {sourcify.length > 0 && (
        <Section
          title="sourcify"
          color="text-amber-600"
          icon={thirdParty}
          subtitle={`${target} on sourcify.dev`}
          lines={sourcify}
          state={done ? gateStatus(contracts.map((contract) => contract.sourcify)) : 'running'}
        />
      )}
      {mode && chain.length > 0 ? (
        <Section
          title={mode}
          color={mode === 'helios' ? 'text-cerulean-blue-500' : 'text-amber-600'}
          icon={
            mode === 'helios' ? (
              <LocallyVerifiedIcon className="h-3.5 w-3.5 shrink-0" title="Verified on this machine" />
            ) : (
              thirdParty
            )
          }
          subtitle={chainId === null ? target : `${target} on ${chainName(chainId)}`}
          lines={chain}
          state={done ? status : 'running'}
        />
      ) : (
        !done && <Cursor />
      )}
    </div>
  )
}

// Counts up to `total`, one step each LINE_PACE.
function usePacedCount(total: number, start: number): number {
  const [count, setCount] = useState(start)
  useEffect(() => {
    if (count >= total) return
    const timer = setTimeout(() => setCount(count + 1), LINE_PACE)
    return () => clearTimeout(timer)
  }, [count, total])
  return count
}

export function GatePage({ request, onBack }: { request: SigningRequest; onBack: () => void }) {
  const store = verificationFor(request)
  const verification = useSyncExternalStore(store.subscribe, store.getSnapshot)
  // A verification that ended before the page opened does not play again.
  const [ended] = useState(() => verification.status !== 'running')
  const shown = usePacedCount(verification.lines.length, ended ? verification.lines.length : 0)
  const done = verification.status !== 'running' && shown === verification.lines.length

  // TODO: collapse by itself when the review below the log exists. Until
  // then the log stays open.
  const [compact, setCompact] = useState(false)

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 py-2">
      <button onClick={onBack} className="self-start font-mono text-xs text-gray-400 hover:text-gray-600">
        ← all requests
      </button>
      <Summary request={request} verification={verification} />
      {/* Always there, so that the page does not move when the checks end. */}
      <button
        onClick={() => setCompact(!compact)}
        className="self-start font-mono text-xs text-gray-400 transition-colors hover:text-gray-600"
      >
        {compact ? 'show logs ▾' : 'hide logs ▴'}
      </button>
      <div
        className={`grid transition-all duration-500 ease-out ${compact ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`}
      >
        <div className="overflow-hidden">
          <GateLog verification={verification} shown={shown} done={done} />
        </div>
      </div>
    </div>
  )
}
