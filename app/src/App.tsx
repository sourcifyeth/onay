import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// Mirrors `Status` and `LinkMessage` in src-tauri/src/link.rs.
type Status = {
  socket: string
  relay: string | null
  manifests: { path: string; error: string | null }[]
  errors: string[]
}
type LinkMessage = { direction: 'in' | 'out'; message: string }
type LogEntry = LinkMessage & { at: string }

export default function App() {
  const [status, setStatus] = useState<Status | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])

  useEffect(() => {
    invoke<Status>('status').then(setStatus)
    const unlisten = listen<LinkMessage>('link-message', (event) => {
      const entry = { ...event.payload, at: new Date().toLocaleTimeString() }
      setLog((log) => [entry, ...log])
    })
    return () => {
      unlisten.then((stop) => stop())
    }
  }, [])

  return (
    <main className="p-6 font-sans text-sm">
      <h1 className="text-2xl font-semibold">Onay</h1>

      <section className="mt-6">
        <h2 className="font-semibold">Browser link</h2>
        {status === null ? (
          <p className="mt-2 text-gray-500">Loading…</p>
        ) : (
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-xs">
            <dt className="text-gray-500">socket</dt>
            <dd>{status.socket}</dd>
            <dt className="text-gray-500">relay</dt>
            <dd>{status.relay ?? 'not found'}</dd>
            <dt className="text-gray-500">host manifests</dt>
            <dd>
              {status.manifests.length === 0 && 'no supported browser found'}
              {status.manifests.map((m) => (
                <div key={m.path}>
                  {m.path} {m.error ? `(failed: ${m.error})` : '(written)'}
                </div>
              ))}
            </dd>
            {status.errors.map((error) => (
              <div key={error} className="col-span-2 text-red-700">
                {error}
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">Messages</h2>
        {log.length === 0 ? (
          <p className="mt-2 text-gray-500">Nothing yet. Open the extension popup and press Ping.</p>
        ) : (
          <ul className="mt-2 font-mono text-xs">
            {log.map((entry, i) => (
              <li key={i}>
                <span className="text-gray-500">{entry.at}</span> {entry.direction === 'in' ? '→ in ' : '← out'}{' '}
                {entry.message}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
