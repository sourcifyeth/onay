import { Fragment, useEffect, useState, useSyncExternalStore } from 'react'
import type { SigningRequest } from './messages.ts'
import { chainName } from './chains.ts'
import { ChainDataStep } from './ChainDataStep.tsx'
import { ClearSigningStep } from './ClearSigningStep.tsx'
import { Cursor, LogLineView } from './Log.tsx'
import { SimulationStep } from './SimulationStep.tsx'
import { VerificationStep } from './VerificationStep.tsx'
import { verificationFor, type TimedLine, type Verification } from './gates/verification.ts'

// The log shows at most one new line in this time, so that you can read it.
// The stamps show the real time of each line.
const LINE_PACE = 200

// What a method asks for, and what you do with it.
const ASKS: Record<string, [string, string]> = {
  eth_sendTransaction: ['a transaction', 'to sign and execute'],
  eth_signTransaction: ['a transaction', 'to sign'],
  wallet_sendCalls: ['a batch of transactions', 'to sign and execute'],
}

function Headline({ request }: { request: SigningRequest }) {
  const [what, task] = ASKS[request.method] ?? ['a message', 'to sign']
  switch (request.source) {
    case 'browser':
      return (
        <>
          Website <span className="text-cerulean-blue-600">{request.origin}</span> created {what} for you {task}
        </>
      )
    case 'paste':
      return (
        <>
          You pasted {what} {task}
        </>
      )
  }
}

const NEXT_STEP = {
  browser: 'Your wallet has the same request now. Check it here before you confirm there.',
  paste: 'Onay only checks it. Nothing is signed or sent.',
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
  const { chainId } = verification
  const label = request.method.startsWith('eth_signTypedData') ? 'Verifying contract' : 'To'
  // The contracts the request names. Their implementations and the
  // contracts the simulation found are in the review below.
  const named = verification.contracts.filter(
    (contract) => contract.foundBy === 'request' && !contract.implementationOf,
  )
  return (
    <section className="animate-fade-up">
      <p className="text-base font-medium text-gray-900">
        <Headline request={request} />
      </p>
      <p className="pt-1 text-sm text-gray-500">{NEXT_STEP[request.source]}</p>
      {named.length === 0 ? (
        chainId !== null && (
          <div className="pt-5">
            <ChainBadge chainId={chainId} />
          </div>
        )
      ) : (
        <div className="grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-1 pt-5">
          {named.map((contract, index) => (
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

// The lines of one gate under its header. The log shows only while the
// run goes on, so the header always has the running dot.
function Section({
  title,
  color,
  subtitle,
  lines,
}: {
  title: string
  color: string
  subtitle: string
  lines: TimedLine[]
}) {
  return (
    <section className="pt-3">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-300 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-yellow-400" />
        </span>
        <span className={color}>{title}</span>
        <span className="truncate text-gray-500">· {subtitle}</span>
      </div>
      <div className="pt-1 pl-4">
        {lines.map((line, index) => (
          <LogLineView key={index} line={line} />
        ))}
        <Cursor />
      </div>
    </section>
  )
}

function GateLog({
  request,
  verification,
  shown,
}: {
  request: SigningRequest
  verification: Verification
  shown: number
}) {
  const { contracts, chainId, chain } = verification
  const mode = chain?.mode ?? null
  const visible = verification.lines.slice(0, shown)
  const asked = visible.filter((line) => line.source === request.source)
  const evm = visible.filter((line) => line.source === 'evm')
  const sourcify = visible.filter((line) => line.source === 'sourcify' || line.source === 'solc')
  const chainLines = visible.filter((line) => line.source === mode)
  const target = contracts.length === 1 ? contracts[0].address : `${contracts.length} contracts`
  return (
    <div className="font-mono text-xs leading-relaxed">
      {asked.map((line, index) => (
        <LogLineView key={index} line={line} tag />
      ))}
      {mode && chainLines.length > 0 ? (
        <Section
          title={mode}
          color={mode === 'helios' ? 'text-cerulean-blue-500' : 'text-amber-600'}
          subtitle={chainId === null ? target : `${target} on ${chainName(chainId)}`}
          lines={chainLines}
        />
      ) : (
        <Cursor />
      )}
      {mode && evm.length > 0 && (
        <Section
          title="evm"
          color="text-cerulean-blue-500"
          subtitle={`local simulation · state from ${mode}`}
          lines={evm}
        />
      )}
      {sourcify.length > 0 && (
        <Section
          title="sourcify"
          color="text-cerulean-blue-500"
          subtitle={`${target} · sources from sourcify.dev, compiled here`}
          lines={sourcify}
        />
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

  // The log is the live run. When the run ends, the cards of the review
  // take its place, each with the lines of its own gate.
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 py-2">
      <button onClick={onBack} className="self-start font-mono text-xs text-gray-400 hover:text-gray-600">
        ← all requests
      </button>
      <Summary request={request} verification={verification} />
      {!done && <GateLog request={request} verification={verification} shown={shown} />}
      {done && verification.chain && (
        <>
          <ChainDataStep verification={verification} />
          <SimulationStep verification={verification} />
          <VerificationStep verification={verification} />
          <ClearSigningStep request={request} verification={verification} />
        </>
      )}
    </div>
  )
}
