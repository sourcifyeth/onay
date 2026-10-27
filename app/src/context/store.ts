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
import type { BlockscoutClaims } from './blockscout.ts'
import type { ExplorerStatus } from './explorers.ts'
import { addressListStore } from './lists.ts'
import { startContext, type Context, type ContextStore, type Deps } from './run.ts'
import { contextSettingsStore } from './settings.ts'

export type { Context, ContextStore } from './run.ts'

type KeptStore = ContextStore & { stop(): void }

const LIST_SETTLE = 1000

const stores = new Map<string, KeptStore>()

// The answers of the explorers for this session, shared by all requests.
const cache = new Map<string, ExplorerStatus>()
const claims = new Map<string, Partial<BlockscoutClaims>>()

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
  lists: () => addressListStore.getSnapshot(),
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
function start(verification: Verification): KeptStore {
  const listeners = new Set<() => void>()
  let stopRun = new AbortController()
  let current = startContext(verification, deps, stopRun.signal)
  let unsubscribe = current.subscribe(notify)
  function notify() {
    for (const listener of listeners) listener()
  }
  const end = () => {
    unsubscribe()
    stopRun.abort()
  }
  const rerun = () => {
    end()
    stopRun = new AbortController()
    current = startContext(verification, deps, stopRun.signal)
    unsubscribe = current.subscribe(notify)
    notify()
  }
  const stopSettings = contextSettingsStore.subscribe(rerun)
  // A refresh changes the sources one by one. One run follows the last.
  let listTimer: ReturnType<typeof setTimeout> | undefined
  const stopLists = addressListStore.subscribe(() => {
    clearTimeout(listTimer)
    listTimer = setTimeout(rerun, LIST_SETTLE)
  })
  return {
    subscribe(listener) {
      listeners.add(listener)
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
