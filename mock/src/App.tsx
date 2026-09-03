import { useCallback, useState } from 'react'
import { mockRequest, type MockRequest } from './data/mockRequest'
import { VerificationCard } from './components/VerificationCard'
import { ClearSigningCard } from './components/ClearSigningCard'
import { PasteCard, type PastedTx } from './components/PasteCard'
import { ExtensionStatus } from './components/ExtensionStatus'
import { DebugBar } from './components/DebugBar'
import { GateLog } from './components/GateLog'

type Phase = 'home' | 'verifying' | 'review' | 'approved' | 'rejected'

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

function Header({ phase, request }: { phase: Phase; request: MockRequest | null }) {
  const label: Record<Phase, string> = {
    home: 'ready',
    verifying: 'verifying…',
    review: 'review the intent',
    approved: 'approved ✓',
    rejected: 'rejected',
  }
  return (
    <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
      <div className="flex items-baseline gap-3">
        <span className="font-vt323 text-3xl text-cerulean-blue-500">Independence</span>
        <span className="font-mono text-xs text-gray-400">transaction verifier</span>
      </div>
      <div className="flex items-center gap-3">
        {request && (
          <span className="rounded-full bg-cerulean-blue-100 px-3 py-1 font-mono text-xs text-cerulean-blue-700">
            {request.chain} · Helios mode
          </span>
        )}
        <span className="font-mono text-xs text-gray-500">{label[phase]}</span>
      </div>
    </header>
  )
}

function App() {
  const [phase, setPhase] = useState<Phase>('home')
  const [request, setRequest] = useState<MockRequest | null>(null)
  const [extensionInstalled, setExtensionInstalled] = useState(true)

  const gateDone = useCallback(() => setPhase('review'), [])

  const startFromExtension = () => {
    setRequest({ ...mockRequest })
    setPhase('verifying')
  }

  const startFromPaste = (tx: PastedTx) => {
    setRequest({
      ...mockRequest,
      chain: chainName(tx.chainId),
      contractAddress: shortAddress(tx.to),
      origin: 'pasted transaction',
      via: 'manual input',
    })
    setPhase('verifying')
  }

  const reset = () => {
    setPhase('home')
    setRequest(null)
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header phase={phase} request={request} />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-6">
        {phase === 'home' && (
          <>
            <PasteCard onVerify={startFromPaste} />
            <ExtensionStatus installed={extensionInstalled} />
          </>
        )}

        {phase !== 'home' && request && (
          <p className="font-mono text-xs text-gray-500">
            {request.method} · from <span className="text-gray-700">{request.origin}</span> · via{' '}
            {request.via}
          </p>
        )}

        {phase !== 'home' && request && (
          <GateLog request={request} running={phase === 'verifying'} onDone={gateDone} />
        )}

        {(phase === 'review' || phase === 'approved' || phase === 'rejected') && request && (
          <div className="animate-fade-up flex flex-col gap-4">
            <VerificationCard request={request} />
            <ClearSigningCard request={request} />
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
          <div className="flex items-center gap-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-sm text-green-800">
              ✓ Approved. The request was handed back to the browser; your wallet takes over as usual.
            </p>
            <button onClick={reset} className="ml-auto font-mono text-xs text-gray-500 hover:text-gray-700">
              ↺ home
            </button>
          </div>
        )}

        {phase === 'rejected' && (
          <div className="flex items-center gap-4 rounded-xl border border-light-coral-200 bg-light-coral-100/50 px-4 py-3">
            <p className="text-sm text-light-coral-800">Rejected. Nothing reached your wallet.</p>
            <button onClick={reset} className="ml-auto font-mono text-xs text-gray-500 hover:text-gray-700">
              ↺ home
            </button>
          </div>
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
