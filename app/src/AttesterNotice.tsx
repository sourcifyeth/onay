// A reminder on the home page while the user trusts no auditor. Clear
// signing shows a descriptor from the registry only after an auditor the
// user chose attested it, so without one it shows the plain decoding.

import { useState, useSyncExternalStore } from 'react'
import { attesterStore } from './clear-signing/attesters.ts'

export function AttesterNotice({ onSettings }: { onSettings: () => void }) {
  const attesters = useSyncExternalStore(attesterStore.subscribe, attesterStore.getSnapshot)
  // Until the app closes.
  const [dismissed, setDismissed] = useState(false)
  if (attesters.length > 0 || dismissed) return null
  return (
    <div className="mt-3 rounded-xl border border-cerulean-blue-200 bg-cerulean-blue-100/50 px-5 py-4">
      <p className="text-sm font-medium text-gray-900">Choose the auditors you trust for clear signing</p>
      <p className="pt-1 text-sm leading-relaxed text-gray-600">
        An ERC-7730 descriptor explains a transaction in plain words. Onay shows one only after an auditor you trust
        attested it. No auditor is chosen yet, so every request shows the decoded calldata only.
      </p>
      <div className="flex gap-3 pt-3">
        <button
          onClick={onSettings}
          className="rounded-lg bg-cerulean-blue-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-cerulean-blue-600"
        >
          Choose auditors
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="rounded-lg border border-gray-300 px-4 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800"
        >
          Later
        </button>
      </div>
    </div>
  )
}
