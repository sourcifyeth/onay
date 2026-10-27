// The context of each signing request, started once its verification
// ended, and kept. It runs again when its settings or the address lists
// change. The run itself is in run.ts; this module gives it the real
// network, chain, lists and settings. React reads it through
// `useSyncExternalStore`.

import { chainStore } from '../chains.ts'
import { registryIndex } from '../clear-signing/registry.ts'
import { tokenListStore } from '../clear-signing/tokenLists.ts'
import { chainReaderFor, creationReaderFor, rpcRequest } from '../gates/helios.ts'
import { requestKey, type Verification } from '../gates/verification.ts'
import type { SigningRequest } from '../messages.ts'
import type { ExplorerStatus } from './explorers.ts'
import { addressListStore } from './lists.ts'
import { changeAction, startContext, type Change, type Context, type ContextStore, type Deps } from './run.ts'
import { contextSettingsStore } from './settings.ts'

export type { Context, ContextStore } from './run.ts'

type KeptStore = ContextStore & { stop(): void }

const LIST_SETTLE = 1000

const stores = new Map<string, KeptStore>()

// The answers of the explorers for this session, shared by all requests.
const cache = new Map<string, ExplorerStatus>()
const claims: Deps['claims'] = new Map()

const deps: Deps = {
  fetch,
  settings: () => contextSettingsStore.getSnapshot(),
  now: () => performance.now(),
  date: () => Date.now(),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  cache,
  claims,
  chainReaderFor: (chain) => ({
    read: chainReaderFor(chain),
    fallback: (method, params) => rpcRequest(chain.executionRpc, method, params),
    proof: chain.mode === 'helios',
  }),
  creationReaderFor: (chain, log) => creationReaderFor(chain, chainReaderFor(chain), log),
  // The first fetch of a list starts with the first run. The run waits
  // for it, so that a list in flight does not show as missing.
  lists: async () => {
    await addressListStore.settled()
    return addressListStore.getSnapshot()
  },
  registryIndex: () => registryIndex(),
  tokenLists: () => tokenListStore.getSnapshot(),
}

export function contextFor(request: SigningRequest, verification: Verification): ContextStore {
  const key = requestKey(request)
  let store = stores.get(key)
  if (!store) {
    // A list that is a day old is fetched again. The change runs the
    // context again.
    void addressListStore.refreshStale(chainStore.getSnapshot().map((chain) => chain.id))
    store = start(verification)
    stores.set(key, store)
  }
  return store
}

export function forgetContext(request: SigningRequest) {
  const key = requestKey(request)
  stores.get(key)?.stop()
  stores.delete(key)
}

// One run at a time. A change of the settings or of the lists stops the
// run and starts a new one, and the store shows that one from then on.
// A store that nobody watches stops its run and starts the new one when
// it gets a listener.
function start(verification: Verification): KeptStore {
  const listeners = new Set<() => void>()
  let stopRun: AbortController
  let current: ContextStore
  let unsubscribe = () => {}
  // The lists that the current run read. Null until it read them.
  let read: object | null = null
  let dirty = false
  function notify() {
    for (const listener of listeners) listener()
  }
  const end = () => {
    unsubscribe()
    stopRun.abort()
  }
  const run = () => {
    const controller = new AbortController()
    stopRun = controller
    read = null
    const lists = async () => {
      const snapshot = await deps.lists()
      // A stopped run does not count.
      if (stopRun === controller) read = snapshot
      return snapshot
    }
    current = startContext(verification, { ...deps, lists }, controller.signal)
    unsubscribe = current.subscribe(notify)
  }
  const rerun = () => {
    end()
    run()
    notify()
  }
  const onChange = (change: Change) => {
    const action = changeAction(change, listeners.size > 0)
    if (action === 'rerun') rerun()
    else if (action === 'later' && !dirty) {
      dirty = true
      end()
    }
  }
  run()
  const stopSettings = contextSettingsStore.subscribe(() => onChange({ kind: 'settings' }))
  // A refresh changes the sources one by one. One run follows the last.
  let listTimer: ReturnType<typeof setTimeout> | undefined
  const stopLists = addressListStore.subscribe(() => {
    clearTimeout(listTimer)
    listTimer = setTimeout(() => onChange({ kind: 'lists', read, now: addressListStore.getSnapshot() }), LIST_SETTLE)
  })
  return {
    subscribe(listener) {
      listeners.add(listener)
      if (dirty) {
        dirty = false
        rerun()
      }
      return () => listeners.delete(listener)
    },
    getSnapshot: (): Context => current.getSnapshot(),
    stop() {
      stopSettings()
      stopLists()
      clearTimeout(listTimer)
      end()
    },
  }
}
