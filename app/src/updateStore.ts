// The state of the update check. It lives outside the components, which
// unmount on each navigation.

import { getVersion } from '@tauri-apps/api/app'
import { errorText } from './gates/gate.ts'
import { CHECK_EVERY, fetchLatestVersion, newerVersion } from './update.ts'

export type UpdateState = {
  // The version of this app. Null until Tauri answers.
  current: string | null
  checking: boolean
  // The highest app release on GitHub, after the last good check.
  latest: string | null
  // The latest release, if it is above the current version.
  newer: string | null
  checkedAt: number | null
  error: string | null
  // The version the user hid the notice for.
  dismissed: string | null
}

let state: UpdateState = {
  current: null,
  checking: false,
  latest: null,
  newer: null,
  checkedAt: null,
  error: null,
  dismissed: null,
}
let started = false
const listeners = new Set<() => void>()
export const updateStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: () => state,
}
function set(change: Partial<UpdateState>) {
  state = { ...state, ...change }
  for (const listener of listeners) listener()
}

export async function checkNow() {
  if (state.checking) return
  set({ checking: true })
  try {
    const current = state.current ?? (await getVersion())
    set({ current })
    const latest = await fetchLatestVersion(fetch)
    set({ latest, newer: newerVersion(current, latest), checkedAt: Date.now(), error: null })
  } catch (error) {
    // The last good answer stays. The next check tries again.
    set({ error: errorText(error) })
  } finally {
    set({ checking: false })
  }
}

// Checks at start and then once a day. Call it once.
export function startUpdateCheck() {
  if (started) return
  started = true
  void checkNow()
  setInterval(() => void checkNow(), CHECK_EVERY)
}

// Hides the notice until GitHub lists a still newer version.
export function dismissUpdate(version: string) {
  set({ dismissed: version })
}
