import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ConnectionInfo, SigningRequest, Snapshot } from './messages.ts'
import { GatePage } from './GatePage.tsx'
import { PasteCard } from './PasteCard.tsx'
import { SettingsPage } from './SettingsPage.tsx'
import { forgetVerification, requestKey, verificationFor } from './gates/verification.ts'
import { forgetClearSigning } from './clear-signing/store.ts'
import { forgetContext } from './context/store.ts'
import { refreshStaleTokenLists } from './clear-signing/tokenLists.ts'
import { AttesterNotice } from './AttesterNotice.tsx'

const OUTCOME_TEXT = {
  fulfilled: 'The wallet signed.',
  rejected: 'The wallet did not sign.',
}

function Pairing({ connection }: { connection: ConnectionInfo }) {
  const answer = (approve: boolean) => invoke('answer_pairing', { connection: connection.id, approve })
  return (
    <div className="mt-3 rounded border border-gray-300 p-4">
      <p>A browser extension wants to pair with this app.</p>
      <p className="mt-2 font-mono text-3xl font-semibold tracking-widest">{connection.pairingCode}</p>
      <p className="mt-2 text-gray-600">
        Approve only if the Onay extension shows the same code.
        {` Browser: ${connection.browser}`}
      </p>
      <div className="mt-3 flex gap-2">
        <button className="rounded bg-[#2b50aa] px-3 py-1 text-white" onClick={() => answer(true)}>
          Approve
        </button>
        <button className="rounded border border-gray-400 px-3 py-1" onClick={() => answer(false)}>
          Reject
        </button>
      </div>
    </div>
  )
}

const STATUS_TEXT = {
  running: 'Checks are running.',
  passed: 'All checks passed.',
  flagged: 'Checks passed, with a warning.',
  reverts: 'The transaction reverts in simulation. Do not sign it.',
  failed: 'A check failed.',
}

const STATUS_COLOR = {
  running: 'text-gray-600',
  passed: 'text-gray-600',
  flagged: 'text-amber-700',
  reverts: 'text-red-700',
  failed: 'text-red-700',
}

function CheckStatus({ request }: { request: SigningRequest }) {
  const store = verificationFor(request)
  const { status } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return <span className={STATUS_COLOR[status]}>{STATUS_TEXT[status]}</span>
}

// Who asks for the request, on its card.
function Asker({ request }: { request: SigningRequest }) {
  const method = <span className="font-mono">{request.method}</span>
  switch (request.source) {
    case 'browser':
      return (
        <>
          <span className="font-semibold">{request.origin}</span> asks for {method}
        </>
      )
    case 'paste':
      return (
        <>
          <span className="font-semibold">You</span> pasted {method}
        </>
      )
  }
}

function Request({ request, onOpen }: { request: SigningRequest; onOpen: () => void }) {
  const dismiss = () => {
    forgetVerification(request)
    forgetClearSigning(request)
    forgetContext(request)
    return invoke('dismiss_request', { connection: request.connection, id: request.id })
  }
  // The page reports the chain of eth_sendTransaction, apart from the request.
  const reportedChain = request.source === 'browser' && request.method === 'eth_sendTransaction'
  return (
    <div className="mt-3 rounded border border-gray-300 p-4">
      <div className="flex items-baseline justify-between gap-4">
        <p>
          <Asker request={request} />
          {reportedChain && (
            <>
              {' '}
              on{' '}
              {request.chainId === null ? (
                <span className="text-[#ae373f]">an unknown chain</span>
              ) : (
                <span className="font-mono">chain {request.chainId}</span>
              )}
            </>
          )}
        </p>
        <span className="shrink-0 text-gray-500">{new Date(request.receivedAt).toLocaleTimeString()}</span>
      </div>
      {reportedChain && (
        <p className="mt-1 text-gray-600">The site reports the chain. Check that your wallet shows the same network.</p>
      )}
      {request.signed && (
        <p className="mt-1 text-gray-600">The transaction is signed. Its sender comes from the signature.</p>
      )}
      <pre className="mt-2 max-h-80 overflow-auto rounded bg-gray-100 p-2 font-mono text-xs break-all whitespace-pre-wrap">
        {JSON.stringify(request.params, null, 2)}
      </pre>
      <div className="mt-2 flex items-center justify-between gap-4">
        <span className="text-gray-600">
          <CheckStatus request={request} />{' '}
          {request.source === 'browser' &&
            (request.outcome ? OUTCOME_TEXT[request.outcome] : 'The wallet has the same request now.')}
        </span>
        <div className="flex shrink-0 gap-2">
          <button className="rounded bg-cerulean-blue-500 px-3 py-1 text-white" onClick={onOpen}>
            Open
          </button>
          <button className="rounded border border-gray-400 px-3 py-1" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  // Set if the link did not start.
  const [failure, setFailure] = useState<string[] | null>(null)

  // The request on its own page, if any.
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [settings, setSettings] = useState(false)
  const seen = useRef(new Set<string>())

  // The token lists refresh once a day.
  useEffect(() => {
    void refreshStaleTokenLists()
  }, [])

  useEffect(() => {
    const load = () => invoke<Snapshot>('link_state').then(setSnapshot, setFailure)
    load()
    const unlisten = listen('link-changed', load)
    return () => {
      unlisten.then((stop) => stop())
    }
  }, [])

  // A new request opens on its own page.
  useEffect(() => {
    const fresh = snapshot?.requests.filter((request) => !seen.current.has(requestKey(request))) ?? []
    for (const request of fresh) seen.current.add(requestKey(request))
    if (fresh.length > 0) setOpenKey(requestKey(fresh[fresh.length - 1]))
  }, [snapshot])

  const errors = failure ?? snapshot?.errors ?? []
  const pairings = snapshot?.connections.filter((c) => c.pairingCode !== null) ?? []
  const requests = snapshot?.requests.toReversed() ?? []
  const connected = snapshot?.connections.some((c) => c.pairingCode === null) ?? false
  const opened = requests.find((request) => requestKey(request) === openKey)

  return (
    <main className="p-6 font-sans text-sm">
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Onay</h1>
          {connected && (
            <span className="flex items-center gap-1.5 font-mono text-xs text-green-600">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              connected
            </span>
          )}
        </div>
        {!opened && !settings && (
          <button onClick={() => setSettings(true)} className="font-mono text-xs text-gray-400 hover:text-gray-600">
            settings
          </button>
        )}
      </div>

      {errors.map((error) => (
        <p key={error} className="mt-3 text-red-700">
          {error}
        </p>
      ))}

      {pairings.map((connection) => (
        <Pairing key={connection.id} connection={connection} />
      ))}

      {opened ? (
        <GatePage key={openKey} request={opened} onBack={() => setOpenKey(null)} />
      ) : settings ? (
        <SettingsPage snapshot={snapshot} onBack={() => setSettings(false)} />
      ) : (
        <>
          <AttesterNotice onSettings={() => setSettings(true)} />
          <PasteCard />
          <section className="mt-6">
            <h2 className="font-semibold">Signing requests</h2>
            {requests.length === 0 && (
              <p className="mt-2 text-gray-500">
                {connected
                  ? 'Nothing yet. A request appears here when a site asks your wallet to sign.'
                  : 'No browser extension is connected.'}
              </p>
            )}
            {requests.map((request) => (
              <Request key={requestKey(request)} request={request} onOpen={() => setOpenKey(requestKey(request))} />
            ))}
          </section>
        </>
      )}
    </main>
  )
}
