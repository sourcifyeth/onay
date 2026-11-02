// The version of the app in the settings, and what GitHub says about it.

import { useSyncExternalStore } from 'react'
import { ExternalLink } from './ExternalLink.tsx'
import { DOWNLOAD_PAGE } from './update.ts'
import { checkNow, updateStore } from './updateStore.ts'

export function DownloadLink() {
  return (
    <ExternalLink href={DOWNLOAD_PAGE} className="text-cerulean-blue-600 hover:underline">
      onay.sh ↗
    </ExternalLink>
  )
}

function Release() {
  const update = useSyncExternalStore(updateStore.subscribe, updateStore.getSnapshot)
  if (update.checkedAt === null) {
    return (
      <p className="text-xs text-gray-500">
        {update.checking ? 'Asking GitHub for the latest release…' : `GitHub did not answer: ${update.error}`}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      {update.newer ? (
        <p className="text-xs text-amber-800">
          GitHub lists a newer release: <span className="font-mono">{update.newer}</span>. Get it from <DownloadLink />.
        </p>
      ) : (
        <p className="text-xs text-gray-600">
          {update.latest === null
            ? 'GitHub lists no app release yet.'
            : 'This is the latest release, according to GitHub.'}
        </p>
      )}
      <p className="font-mono text-xs text-gray-400">
        checked {new Date(update.checkedAt).toLocaleString()}
        {update.error && <span className="text-light-coral-700"> · last check failed: {update.error}</span>}
      </p>
    </div>
  )
}

export function UpdateStatus() {
  const update = useSyncExternalStore(updateStore.subscribe, updateStore.getSnapshot)
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-4 pb-2">
        <p className="font-medium text-gray-800">
          Onay <span className="font-mono">{update.current ?? '…'}</span>
        </p>
        <button
          onClick={() => void checkNow()}
          disabled={update.checking}
          className="font-mono text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40"
        >
          {update.checking ? 'checking…' : 'check now'}
        </button>
      </div>
      <Release />
    </section>
  )
}
