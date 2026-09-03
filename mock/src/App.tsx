import { useCallback, useState } from 'react'
import { mockRequest, type MockRequest } from './data/mockRequest'
import { ContractsSection } from './components/ContractsSection'
import { TransactionCard } from './components/TransactionCard'
import { PasteCard, type PastedTx } from './components/PasteCard'
import { ExtensionStatus } from './components/ExtensionStatus'
import { DebugBar } from './components/DebugBar'
import { SettingsPage, defaultChains, type ChainConfig } from './components/SettingsPage'
import { GateLog } from './components/GateLog'

type Phase = 'home' | 'settings' | 'verifying' | 'review' | 'approved' | 'rejected'

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

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function Header({
  request,
  onSettings,
}: {
  request: MockRequest | null
  onSettings?: () => void
}) {
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
          <p className="flex items-center justify-end gap-1.5 pt-0.5 font-mono text-[10px] uppercase tracking-wide text-cerulean-blue-600">
            <span className="h-1.5 w-1.5 rounded-full bg-cerulean-blue-500" />
            Helios mode
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
}: {
  tone: 'ok' | 'blocked'
  title: string
  message: string
  onHome: () => void
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
      <button
        onClick={onHome}
        className="mt-4 rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:border-cerulean-blue-400 hover:text-cerulean-blue-600"
      >
        Back to home
      </button>
    </div>
  )
}

function App() {
  const [phase, setPhase] = useState<Phase>('home')
  const [request, setRequest] = useState<MockRequest | null>(null)
  const [extensionInstalled, setExtensionInstalled] = useState(true)
  const [chains, setChains] = useState<ChainConfig[]>(defaultChains)

  const gateDone = useCallback(() => setPhase('review'), [])

  const startFromExtension = () => {
    setRequest({ ...mockRequest })
    setPhase('verifying')
  }

  const startFromPaste = (tx: PastedTx) => {
    const chain = chainName(tx.chainId)
    const [first, ...rest] = mockRequest.contracts
    setRequest({
      ...mockRequest,
      chain,
      origin: 'pasted transaction',
      via: 'manual input',
      contracts: [{ ...first, address: shortAddress(tx.to) }, ...rest],
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

        {phase !== 'home' && request && (
          <GateLog request={request} running={phase === 'verifying'} onDone={gateDone} />
        )}

        {(phase === 'review' || phase === 'approved' || phase === 'rejected') && request && (
          <div className="animate-fade-up flex flex-col gap-4">
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

        {phase === 'approved' && (
          <EndState
            tone="ok"
            title="Handed back to your wallet"
            message="The request continued to the browser, untouched. Confirm it in your wallet as usual."
            onHome={reset}
          />
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
        onSimulateInterception={startFromExtension}
        onToggleExtension={() => setExtensionInstalled((v) => !v)}
        onReset={reset}
      />
    </div>
  )
}

export default App
