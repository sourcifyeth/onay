// A reminder on the home page while the user trusts no auditor. Clear
// signing counts a descriptor from the registry as reviewed only after an
// auditor the user chose attested it; without one it shows a preview.

import { useSyncExternalStore } from 'react'
import { attesterStore } from './clear-signing/attesters.ts'

// "Later" holds until the app closes, so the flag lives outside the
// component, which unmounts on each navigation.
let dismissed = false
const listeners = new Set<() => void>()
const dismissedStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: () => dismissed,
}
function dismiss() {
  dismissed = true
  for (const listener of listeners) listener()
}

export function AttesterNotice({ onSettings }: { onSettings: () => void }) {
  const attesters = useSyncExternalStore(attesterStore.subscribe, attesterStore.getSnapshot)
  const hidden = useSyncExternalStore(dismissedStore.subscribe, dismissedStore.getSnapshot)
  if (attesters.length > 0 || hidden) return null
  return (
    <div className="mt-3 rounded-xl border border-cerulean-blue-200 bg-cerulean-blue-100/50 px-5 py-4">
      <p className="text-sm font-medium text-gray-900">Choose the auditors you trust for Clear Signing</p>
      <p className="pt-1 text-sm leading-relaxed text-gray-600">
        An ERC-7730 descriptor explains a transaction in plain words. Onay counts one as reviewed only after an auditor
        you trust attested it. No auditor is chosen yet, so every descriptor shows as a preview with a warning.
      </p>
      <div className="flex gap-3 pt-3">
        <button
          onClick={onSettings}
          className="rounded-lg bg-cerulean-blue-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-cerulean-blue-600"
        >
          Choose auditors
        </button>
        <button
          onClick={dismiss}
          className="rounded-lg border border-gray-300 px-4 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800"
        >
          Later
        </button>
      </div>
    </div>
  )
}
