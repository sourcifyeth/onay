import { useEffect, useState, useSyncExternalStore } from 'react'
import type { SigningRequest } from './messages.ts'
import { CHAIN_NAMES } from './gates/chain.ts'
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

function Summary({ request, verification }: { request: SigningRequest; verification: Verification }) {
  const { checks, chainId } = verification
  const label = request.method.startsWith('eth_signTypedData') ? 'Verifying contract' : 'To'
  return (
    <section className="animate-fade-up">
      <p className="text-base font-medium text-gray-900">
        <Headline request={request} />
      </p>
      <p className="pt-1 text-sm text-gray-500">
        Your wallet has the same request now. Check it here before you confirm there.
      </p>
      <div className="pt-5">
        {checks.length > 0 && <p className="text-xs text-gray-500">{label}</p>}
        {checks.map((check) => (
          <p key={check.address} className="font-mono text-lg font-medium break-all text-gray-900">
            {check.address}
          </p>
        ))}
        <p className="pt-1 text-base text-gray-700">
          {CHAIN_NAMES[chainId] ?? `Chain ${chainId}`} - chainId: {chainId}
        </p>
      </div>
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
  subtitle,
  lines,
  state,
}: {
  title: string
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
        <span className="text-cerulean-blue-500">{title}</span>
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

function GateLog({ verification, shown, done }: { verification: Verification; shown: number; done: boolean }) {
  const { checks, chainId, status } = verification
  const visible = verification.lines.slice(0, shown)
  const browser = visible.filter((line) => line.source === 'browser')
  const helios = visible.filter((line) => line.source === 'helios')
  const target = checks.length === 1 ? checks[0].address : `${checks.length} contracts`
  return (
    <div className="font-mono text-xs leading-relaxed">
      {browser.map((line, index) => (
        <LogLineView key={index} line={line} tag />
      ))}
      {helios.length > 0 ? (
        <Section
          title="helios"
          subtitle={`${target} on ${CHAIN_NAMES[chainId] ?? `chain ${chainId}`}`}
          lines={helios}
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-2">
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
