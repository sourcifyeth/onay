// The update check of the app, with the calls of Tauri and the browser.

import { getVersion } from '@tauri-apps/api/app'
import { createUpdateStore, TICK_EVERY } from './updateStore.ts'

export const updateStore = createUpdateStore({ getVersion, fetch: (url, init) => fetch(url, init), now: Date.now })

let started = false

// Checks at start, and then whenever a check is due. Call it once.
export function startUpdateCheck() {
  if (started) return
  started = true
  void updateStore.tick()
  setInterval(() => void updateStore.tick(), TICK_EVERY)
}
