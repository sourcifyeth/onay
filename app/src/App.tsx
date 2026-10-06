import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ConnectionInfo, SigningRequest, Snapshot } from './messages.ts'
import { GatePage } from './GatePage.tsx'
import { forgetVerification, requestKey, verificationFor } from './gates/verification.ts'

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
        {connection.browser && ` Browser: ${connection.browser}`}
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
  failed: 'A check failed.',
}

function CheckStatus({ request }: { request: SigningRequest }) {
  const store = verificationFor(request)
  const { status } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return <span className={status === 'failed' ? 'text-red-700' : 'text-gray-600'}>{STATUS_TEXT[status]}</span>
}

function Request({ request, onOpen }: { request: SigningRequest; onOpen: () => void }) {
  const dismiss = () => {
    forgetVerification(request)
    return invoke('dismiss_request', { connection: request.connection, id: request.id })
  }
  return (
    <div className="mt-3 rounded border border-gray-300 p-4">
      <div className="flex items-baseline justify-between gap-4">
        <p>
          <span className="font-semibold">{request.origin}</span> asks for{' '}
          <span className="font-mono">{request.method}</span>
          {request.method === 'eth_sendTransaction' && (
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
      {request.method === 'eth_sendTransaction' && (
        <p className="mt-1 text-gray-600">The site reports the chain. Check that your wallet shows the same network.</p>
      )}
      <pre className="mt-2 max-h-80 overflow-auto rounded bg-gray-100 p-2 font-mono text-xs break-all whitespace-pre-wrap">
        {JSON.stringify(request.params, null, 2)}
      </pre>
      <div className="mt-2 flex items-center justify-between gap-4">
        <span className="text-gray-600">
          <CheckStatus request={request} />{' '}
          {request.outcome ? OUTCOME_TEXT[request.outcome] : 'The wallet has the same request now.'}
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

function Details({ snapshot }: { snapshot: Snapshot }) {
  return (
    <details className="mt-8 text-xs">
      <summary className="cursor-pointer text-sm font-semibold">Browser link</summary>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono">
        <dt className="text-gray-500">socket</dt>
        <dd>{snapshot.socket}</dd>
        <dt className="text-gray-500">relay</dt>
        <dd>{snapshot.relay ?? 'not found'}</dd>
        <dt className="text-gray-500">host manifests</dt>
        <dd>
          {snapshot.manifests.length === 0 && 'no supported browser found'}
          {snapshot.manifests.map((m) => (
            <div key={m.path}>
              {m.path} {m.error ? `(failed: ${m.error})` : '(written)'}
            </div>
          ))}
        </dd>
        <dt className="text-gray-500">connections</dt>
        <dd>
          {snapshot.connections.length === 0 && 'none'}
          {snapshot.connections.map((c) => (
            <div key={c.id}>
              {c.browser ?? 'unknown browser'} ({c.verified ? 'verified' : 'not verified on this system'}
              {c.pairingCode ? ', waits for pairing' : ', paired'})
            </div>
          ))}
        </dd>
        {snapshot.rejected.length > 0 && (
          <>
            <dt className="text-gray-500">refused</dt>
            <dd>
              {snapshot.rejected.map((reason, i) => (
                <div key={i}>{reason}</div>
              ))}
            </dd>
          </>
        )}
      </dl>
    </details>
  )
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  // Set if the link did not start.
  const [failure, setFailure] = useState<string[] | null>(null)

  // The request on its own page, if any.
  const [openKey, setOpenKey] = useState<string | null>(null)
  const seen = useRef(new Set<string>())

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
      <h1 className="text-2xl font-semibold">Onay</h1>

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
      ) : (
        <>
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

          {snapshot && <Details snapshot={snapshot} />}
        </>
      )}
    </main>
  )
}
