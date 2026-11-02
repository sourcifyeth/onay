// A note on the home page when GitHub lists a newer release of the app.

import { useSyncExternalStore } from 'react'
import { dismissUpdate, updateStore } from './updateStore.ts'
import { DownloadLink } from './UpdateStatus.tsx'

export function UpdateNotice() {
  const update = useSyncExternalStore(updateStore.subscribe, updateStore.getSnapshot)
  if (!update.newer || !update.current || update.newer === update.dismissed) return null
  const newer = update.newer
  return (
    <div className="mt-3 rounded-xl border border-cerulean-blue-200 bg-cerulean-blue-100/50 px-5 py-4">
      <p className="text-sm font-medium text-gray-900">Onay {newer} is available</p>
      <p className="pt-1 text-sm leading-relaxed text-gray-600">
        GitHub lists a new release of Onay. This app is version {update.current}. Get the new version from{' '}
        <DownloadLink />.
      </p>
      <div className="flex gap-3 pt-3">
        <button
          onClick={() => dismissUpdate(newer)}
          className="rounded-lg border border-gray-300 px-4 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800"
        >
          Later
        </button>
      </div>
    </div>
  )
}
