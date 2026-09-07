import { useCallback, useState, type ReactNode } from 'react'
import { mockRequest, scenarios, type MockRequest } from './data/mockRequest'
import { ContractsSection } from './components/ContractsSection'
import { TransactionCard } from './components/TransactionCard'
import { PasteCard, type PastedTx } from './components/PasteCard'
import { ExtensionStatus } from './components/ExtensionStatus'
import { DebugBar } from './components/DebugBar'
import { SettingsPage, defaultChains, type ChainConfig } from './components/SettingsPage'
import { GateLog } from './components/GateLog'

type Phase = 'home' | 'settings' | 'verifying' | 'failed' | 'review' | 'approved' | 'rejected'

function chainName(chainId: number): string {
  const known: Record<number, string> = {
    1: 'Ethereum mainnet',
    11155111: 'Sepolia',
    10: 'OP Mainnet',
    8453: 'Base',
    59144: 'Linea',
  }
  return known[chainId] ?? `chain ${chainId}`
}

function Header({
  request,
  onSettings,
}: {
  request: MockRequest | null
  onSettings?: () => void
}) {
  const helios = request?.chainMode === 'helios'
  return (
    <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
      <span className="font-vt323 text-3xl text-cerulean-blue-500">Independence</span>
      {onSettings && (
        <button
          onClick={onSettings}
          title="Settings"
          className="font-mono text-xs text-gray-400 hover:text-gray-600"
        >
          settings
        </button>
      )}
      {request && (
        <div className="text-right">
          <p className="font-mono text-xs text-gray-700">{request.chain}</p>
          <p
            className={`flex items-center justify-end gap-1.5 pt-0.5 font-mono text-[10px] uppercase tracking-wide ${
              helios ? 'text-cerulean-blue-600' : 'text-amber-600'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${helios ? 'bg-cerulean-blue-500' : 'bg-amber-500'}`}
            />
            {helios ? 'Helios mode' : 'RPC mode'}
          </p>
        </div>
      )}
    </header>
  )
}

function EndState({
  tone,
  title,
  message,
  onHome,
  children,
}: {
  tone: 'ok' | 'blocked'
  title: string
  message: string
  onHome: () => void
  children?: ReactNode
}) {
  const ok = tone === 'ok'
  return (
    <div className="animate-fade-up flex flex-col items-center gap-2 rounded-xl border border-gray-200 bg-white px-6 py-10 text-center shadow-sm">
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-full border-2 text-lg ${
          ok ? 'border-green-500 text-green-600' : 'border-light-coral-500 text-light-coral-600'
        }`}
      >
        {ok ? '✓' : '✕'}
      </span>
      <p className="pt-2 text-base font-medium text-gray-900">{title}</p>
      <p className="max-w-sm text-sm text-gray-500">{message}</p>
      {children}
      <button
        onClick={onHome}
        className="mt-4 rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:border-cerulean-blue-400 hover:text-cerulean-blue-600"
      >
        Back to home
      </button>
    </div>
  )
}

function DigestBox({ digest }: { digest: { label: string; value: string } }) {
  return (
    <div className="mt-2 w-full max-w-md rounded-lg border border-gray-200 bg-gray-50 p-4 text-left">
      <p className="flex items-baseline justify-between font-mono text-xs text-gray-500">
        <span>{digest.label}</span>
        <a
          href="https://eip.tools/eip/8213"
          target="_blank"
          rel="noreferrer"
          className="text-gray-400 hover:text-cerulean-blue-600"
        >
          ERC-8213 ↗
        </a>
      </p>
      <p className="break-all pt-1 font-mono text-xs text-gray-800">{digest.value}</p>
      <p className="pt-2 text-xs leading-relaxed text-gray-500">
        If your wallet shows a {digest.label} before signing, it must match this one exactly. A
        match proves your wallet received exactly what you just reviewed here.
      </p>
    </div>
  )
}

function FailedCard({
  request,
  onReject,
  onReviewAnyway,
}: {
  request: MockRequest
  onReject: () => void
  onReviewAnyway: () => void
}) {
  const reverted = request.outcome === 'reverted'
  const title = reverted ? 'Transaction reverts in simulation' : 'Contract could not be verified'
  const message = reverted
    ? `Simulated against the latest verified chain state, this transaction reverts with "${request.revertReason}". Sending it would only waste gas.`
    : `${request.contracts[0]?.address ?? 'The target contract'} has no match on Sourcify, so there is no source code to review and nothing proves what this call does.`
  return (
    <div className="animate-fade-up rounded-xl border border-light-coral-300 bg-white p-6 shadow-sm">
      <p className="text-base font-medium text-gray-900">{title}</p>
      <p className="pt-1 text-sm leading-relaxed text-gray-600">{message}</p>
      <div className="flex items-center gap-4 pt-4">
        <button
          onClick={onReject}
          className="rounded-lg bg-light-coral-600 px-5 py-2 text-sm font-medium text-white hover:bg-light-coral-700"
        >
          Reject
        </button>
        <button
          onClick={onReviewAnyway}
          className="font-mono text-xs text-gray-400 underline decoration-gray-300 underline-offset-2 hover:text-gray-600"
        >
          review anyway
        </button>
      </div>
    </div>
  )
}

function App() {
  const [phase, setPhase] = useState<Phase>('home')
  const [request, setRequest] = useState<MockRequest | null>(null)
  const [extensionInstalled, setExtensionInstalled] = useState(true)
  const [chains, setChains] = useState<ChainConfig[]>(defaultChains)
  const [scenarioId, setScenarioId] = useState(scenarios[0].id)

  const gateDone = useCallback(() => {
    setPhase((request?.outcome ?? 'verified') === 'verified' ? 'review' : 'failed')
  }, [request])

  const startFromExtension = () => {
    const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0]
    setRequest({ ...scenario.request })
    setPhase('verifying')
  }

  const startFromPaste = (tx: PastedTx) => {
    const chain = chainName(tx.chainId)
    const [first, ...rest] = mockRequest.contracts
    setRequest({
      ...mockRequest,
      chain,
      chainId: tx.chainId,
      origin: 'pasted transaction',
      via: 'manual input',
      contracts: [{ ...first, address: tx.to }, ...rest],
    })
    setPhase('verifying')
  }

  const reset = () => {
    setPhase('home')
    setRequest(null)
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header request={request} onSettings={phase === 'home' ? () => setPhase('settings') : undefined} />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-6">
        {phase === 'home' && (
          <>
            <PasteCard onVerify={startFromPaste} />
            <ExtensionStatus installed={extensionInstalled} />
          </>
        )}

        {phase === 'settings' && (
          <SettingsPage chains={chains} onChainsChange={setChains} onBack={() => setPhase('home')} />
        )}

        {phase !== 'home' && phase !== 'settings' && request && (
          <GateLog request={request} running={phase === 'verifying'} onDone={gateDone} />
        )}

        {phase === 'failed' && request && (
          <FailedCard
            request={request}
            onReject={() => setPhase('rejected')}
            onReviewAnyway={() => setPhase('review')}
          />
        )}

        {(phase === 'review' || phase === 'approved' || phase === 'rejected') && request && (
          <div className="animate-fade-up flex flex-col gap-4">
            {request.chainMode === 'rpc' && (
              <p className="rounded-lg border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                {request.chain} runs in RPC mode: nothing on this page is verified by Helios. The
                chain state behind it comes straight from the configured endpoint.
              </p>
            )}
            <ContractsSection request={request} />
            <TransactionCard request={request} />
          </div>
        )}

        {phase === 'review' && (
          <div className="flex gap-3">
            <button
              onClick={() => setPhase('approved')}
              className="rounded-lg bg-cerulean-blue-500 px-5 py-2 text-sm font-medium text-white hover:bg-cerulean-blue-600"
            >
              Confirm &amp; continue
            </button>
            <button
              onClick={() => setPhase('rejected')}
              className="rounded-lg border border-light-coral-600 px-5 py-2 text-sm font-medium text-light-coral-700 hover:bg-light-coral-100"
            >
              Reject
            </button>
          </div>
        )}

        {phase === 'approved' && request && (
          <EndState
            tone="ok"
            title="Handed back to your wallet"
            message="The request continued to the browser, untouched. Confirm it in your wallet as usual."
            onHome={reset}
          >
            {request.digest && <DigestBox digest={request.digest} />}
          </EndState>
        )}

        {phase === 'rejected' && (
          <EndState
            tone="blocked"
            title="Request rejected"
            message="Nothing reached your wallet."
            onHome={reset}
          />
        )}
      </main>
      <DebugBar
        phase={phase}
        extensionInstalled={extensionInstalled}
        scenarios={scenarios}
        scenarioId={scenarioId}
        onScenarioChange={setScenarioId}
        onSimulateInterception={startFromExtension}
        onToggleExtension={() => setExtensionInstalled((v) => !v)}
        onReset={reset}
      />
    </div>
  )
}

export default App
