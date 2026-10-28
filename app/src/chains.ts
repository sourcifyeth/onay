// The chains that the app reads, and how. The list is saved in the
// webview. Each chain in Helios mode has a Helios client in Rust, which
// this module starts and stops. The defaults and the merge with the saved
// list live in `chainList.ts`.

import { invoke } from '@tauri-apps/api/core'
import { mergeChains, type ChainConfig } from './chainList.ts'
import type { StartChainArgs, StopChainArgs } from './messages.ts'

export type { ChainConfig } from './chainList.ts'

const STORAGE_KEY = 'onay.chains'

let chains = load()
const listeners = new Set<() => void>()
// The start of each Helios client. It rejects if the client did not start.
const heliosStarts = new Map<number, Promise<void>>()

for (const chain of chains) startHelios(chain)

export const chainStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: () => chains,
}

export function chainById(id: number): ChainConfig | undefined {
  return chains.find((chain) => chain.id === id)
}

export function chainName(id: number): string {
  return chainById(id)?.name ?? `chain ${id}`
}

// Resolves when the Helios client of the chain runs.
export function heliosStarted(id: number): Promise<void> {
  return heliosStarts.get(id) ?? Promise.reject(new Error(`Helios does not run for chain ${id}`))
}

// Saves the list, then starts, restarts, or stops the Helios clients that
// changed.
export function saveChains(next: ChainConfig[]) {
  const before = chains
  chains = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // The change stays until the app closes.
  }
  for (const listener of listeners) listener()

  for (const chain of next) {
    const old = before.find((other) => other.id === chain.id)
    if (JSON.stringify(old) !== JSON.stringify(chain)) startHelios(chain)
  }
  for (const old of before) {
    const now = next.find((chain) => chain.id === old.id)
    if (old.mode === 'helios' && now?.mode !== 'helios') {
      heliosStarts.delete(old.id)
      void invoke('stop_chain', { chainId: old.id } satisfies StopChainArgs)
    }
  }
}

function startHelios(chain: ChainConfig) {
  if (chain.mode !== 'helios') return
  const args: StartChainArgs = {
    chainId: chain.id,
    consensusRpc: chain.consensusRpc ?? '',
    executionRpc: chain.executionRpc,
  }
  const start = invoke<void>('start_chain', args)
  // A gate reports the error when it waits for this chain.
  start.catch(() => {})
  heliosStarts.set(chain.id, start)
}

function load(): ChainConfig[] {
  let saved: unknown = null
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
  } catch {
    // Use the defaults.
  }
  return mergeChains(saved)
}
