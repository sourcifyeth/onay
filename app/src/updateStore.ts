// The state of the update check. It lives outside the notice, which
// unmounts on each navigation.

import { getVersion } from '@tauri-apps/api/app'
import { CHECK_EVERY, checkForUpdate } from './update.ts'

type UpdateState = { current: string; newer: string } | null

let state: UpdateState = null
let dismissed: string | null = null
let started = false
const listeners = new Set<() => void>()
export const updateStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: () => (state && state.newer !== dismissed ? state : null),
}
function emit() {
  for (const listener of listeners) listener()
}

async function check() {
  try {
    const current = await getVersion()
    const newer = await checkForUpdate(current, fetch)
    state = newer ? { current, newer } : null
    emit()
  } catch (error) {
    // A failed check shows nothing. The next check tries again.
    console.error('update check:', error)
  }
}

// Checks at start and then once a day. Call it once.
export function startUpdateCheck() {
  if (started) return
  started = true
  void check()
  setInterval(() => void check(), CHECK_EVERY)
}

// Hides the notice until GitHub lists a still newer version.
export function dismissUpdate(version: string) {
  dismissed = version
  emit()
}
