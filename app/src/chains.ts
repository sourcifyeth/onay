// The chains that the app knows, and how it reads each one. The list is
// saved in the webview. Each chain in Helios mode has a Helios client in
// Rust, which this module starts and stops.

import { invoke } from '@tauri-apps/api/core'
import type { StartChainArgs, StopChainArgs } from './messages.ts'

export type ChainConfig = {
  id: number
  name: string
  // 'helios': the light client checks each answer with a proof.
  // 'rpc': the answers come from the endpoint without a check.
  mode: 'helios' | 'rpc'
  // In Helios mode, it must have `eth_getProof`.
  executionRpc: string
  // Helios mode only: a beacon node with the light client API.
  consensusRpc?: string
  // Added by the user, so the user can remove it.
  custom?: boolean
}

// Helios mode supports only the Ethereum chains (Helios 0.12.0):
// - Linea: Helios stops its support. Linea blocks do not carry the
//   sequencer signature that Helios checks, and the sync stops.
//   https://github.com/a16z/helios/pull/833
// - OP Stack: the Helios server gets no blocks on the mainnet chains, so
//   the default servers do not answer.
//   https://github.com/a16z/helios/pull/801
const DEFAULT_CHAINS: ChainConfig[] = [
  {
    id: 1,
    name: 'Ethereum mainnet',
    mode: 'helios',
    executionRpc: 'https://ethereum-rpc.publicnode.com',
    consensusRpc: 'https://ethereum-beacon-api.publicnode.com',
  },
  {
    id: 11155111,
    name: 'Sepolia',
    mode: 'helios',
    executionRpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    consensusRpc: 'https://ethereum-sepolia-beacon-api.publicnode.com',
  },
  {
    id: 560048,
    name: 'Hoodi',
    mode: 'helios',
    executionRpc: 'https://ethereum-hoodi-rpc.publicnode.com',
    consensusRpc: 'https://ethereum-hoodi-beacon-api.publicnode.com',
  },
  { id: 42161, name: 'Arbitrum One', mode: 'rpc', executionRpc: 'https://arb1.arbitrum.io/rpc' },
]

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

// The built-in chains with the saved edits, then the chains that the user
// added. A built-in chain of a newer version shows up with its defaults.
function load(): ChainConfig[] {
  let saved: ChainConfig[] = []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (Array.isArray(parsed)) saved = parsed.filter(isChainConfig)
  } catch {
    // Use the defaults.
  }
  const builtIn = DEFAULT_CHAINS.map((chain) => saved.find((other) => other.id === chain.id && !other.custom) ?? chain)
  const custom = saved.filter((chain) => chain.custom && !DEFAULT_CHAINS.some((other) => other.id === chain.id))
  return [...builtIn, ...custom]
}

function isChainConfig(value: unknown): value is ChainConfig {
  const chain = value as Partial<ChainConfig> | null
  return (
    typeof chain?.id === 'number' &&
    typeof chain.name === 'string' &&
    (chain.mode === 'helios' || chain.mode === 'rpc') &&
    typeof chain.executionRpc === 'string'
  )
}
