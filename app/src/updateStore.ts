// The state of the update check. The store takes the app version, the
// network, and the clock as parameters, so the tests run it.

import { errorText, type Fetch } from './gates/gate.ts'
import { fetchLatestVersion, releaseStatus, type ReleaseStatus } from './update.ts'

// A good check holds for a day.
export const CHECK_EVERY = 24 * 60 * 60 * 1000
// A failed check is tried again after this time.
export const RETRY_AFTER = 15 * 60 * 1000
// The timer asks this often whether a check is due. The timers of the
// webview stop while the computer sleeps, so the clock decides, not the timer.
export const TICK_EVERY = 5 * 60 * 1000

export type UpdateState = {
  // The version of this app. Null until the app answers.
  current: string | null
  checking: boolean
  // The highest app release on GitHub, after the last good check.
  latest: string | null
  // The time of the last good check.
  checkedAt: number | null
  // The time of the last check, good or failed.
  attemptedAt: number | null
  // The error of the last check. A good check clears it.
  error: string | null
  // The version the user hid the notice for.
  dismissed: string | null
}

export type UpdateDeps = {
  getVersion: () => Promise<string>
  fetch: Fetch
  now: () => number
}

// The release status after the last good check. Null before it.
export function statusOf(state: UpdateState): ReleaseStatus | null {
  return state.current === null || state.checkedAt === null ? null : releaseStatus(state.current, state.latest)
}

// The version for the notice on the home page, or null.
export function noticeOf(state: UpdateState): string | null {
  return statusOf(state) === 'newer' && state.latest !== state.dismissed ? state.latest : null
}

export function createUpdateStore({ getVersion, fetch, now }: UpdateDeps) {
  let state: UpdateState = {
    current: null,
    checking: false,
    latest: null,
    checkedAt: null,
    attemptedAt: null,
    error: null,
    dismissed: null,
  }
  const listeners = new Set<() => void>()
  const set = (change: Partial<UpdateState>) => {
    state = { ...state, ...change }
    for (const listener of listeners) listener()
  }

  const checkNow = async () => {
    if (state.checking) return
    set({ checking: true })
    try {
      const current = state.current ?? (await getVersion())
      set({ current })
      const latest = await fetchLatestVersion(fetch)
      const time = now()
      set({ latest, checkedAt: time, attemptedAt: time, error: null })
    } catch (error) {
      // The last good answer stays.
      set({ attemptedAt: now(), error: errorText(error) })
    } finally {
      set({ checking: false })
    }
  }

  // Checks if the last check is old enough: a day after a good one,
  // RETRY_AFTER after a failed one.
  const tick = async () => {
    if (state.checking) return
    const wait = state.error === null ? CHECK_EVERY : RETRY_AFTER
    if (state.attemptedAt === null || now() - state.attemptedAt >= wait) await checkNow()
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => state,
    checkNow,
    tick,
    // Hides the notice until GitHub lists a still newer version.
    dismiss: (version: string) => set({ dismissed: version }),
  }
}

export type UpdateStore = ReturnType<typeof createUpdateStore>
