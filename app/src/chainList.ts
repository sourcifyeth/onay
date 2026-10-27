// The chain list: the built-in chains, and the check of a saved list.
// This module has no browser or Tauri calls, so the tests run it.

import { EXPLORER_HOSTS } from './context/explorers.ts'

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
  // The block explorers, as https URLs. Not set: the built-in host for
  // the chain id, if any. Empty: no such explorer for this chain.
  etherscan?: string
  blockscout?: string
  // Set only if the API of the Blockscout instance is on another host.
  blockscoutApi?: string
}

export const EXPLORER_FIELDS = ['etherscan', 'blockscout', 'blockscoutApi'] as const

const explorers = (id: number) => ({
  etherscan: EXPLORER_HOSTS[id].etherscan,
  blockscout: EXPLORER_HOSTS[id].blockscout,
})

// Helios mode supports only the Ethereum chains (Helios 0.12.0):
// - Linea: Helios stops its support. Linea blocks do not carry the
//   sequencer signature that Helios checks, and the sync stops.
//   https://github.com/a16z/helios/pull/833
// - OP Stack: the Helios server gets no blocks on the mainnet chains, so
//   the default servers do not answer.
//   https://github.com/a16z/helios/pull/801
//
// The execution endpoint of a Helios chain must answer eth_getProof for
// blocks a few behind its head, because Helios asks at its own head, which
// lags the node. Publicnode serves proofs for the newest block only, so it
// is not used here. Checked on 2026-10-08: dRPC and Tenderly serve proofs
// at least 10 blocks back.
export const DEFAULT_CHAINS: ChainConfig[] = [
  {
    id: 1,
    name: 'Ethereum mainnet',
    mode: 'helios',
    executionRpc: 'https://eth.drpc.org',
    consensusRpc: 'https://ethereum-beacon-api.publicnode.com',
    ...explorers(1),
  },
  {
    id: 11155111,
    name: 'Sepolia',
    mode: 'helios',
    executionRpc: 'https://sepolia.gateway.tenderly.co',
    consensusRpc: 'https://ethereum-sepolia-beacon-api.publicnode.com',
    ...explorers(11155111),
  },
  {
    id: 560048,
    name: 'Hoodi',
    mode: 'helios',
    executionRpc: 'https://hoodi.drpc.org',
    consensusRpc: 'https://ethereum-hoodi-beacon-api.publicnode.com',
    ...explorers(560048),
  },
  { id: 42161, name: 'Arbitrum One', mode: 'rpc', executionRpc: 'https://arb1.arbitrum.io/rpc', ...explorers(42161) },
]

export function isHttpsUrl(value: string): boolean {
  if (!/^https:\/\/\S+$/.test(value)) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

// An explorer field is empty or an https URL.
export const isExplorerField = (value: string) => value === '' || isHttpsUrl(value)

function isChainConfig(value: unknown): value is ChainConfig {
  const chain = value as Partial<ChainConfig> | null
  return (
    typeof chain?.id === 'number' &&
    typeof chain.name === 'string' &&
    (chain.mode === 'helios' || chain.mode === 'rpc') &&
    typeof chain.executionRpc === 'string'
  )
}

// The chain with its explorer fields checked: a bad value is dropped,
// not the chain.
function withValidExplorers(chain: ChainConfig): ChainConfig {
  const result = { ...chain }
  for (const field of EXPLORER_FIELDS) {
    const value: unknown = result[field]
    if (value !== undefined && (typeof value !== 'string' || !isExplorerField(value))) delete result[field]
  }
  return result
}

// The built-in chains with the saved edits, then the chains that the user
// added. A built-in chain of a newer version shows up with its defaults,
// and a field that an older save does not have gets its default.
export function loadChains(stored: string | null): ChainConfig[] {
  let saved: ChainConfig[] = []
  try {
    const parsed: unknown = JSON.parse(stored ?? 'null')
    if (Array.isArray(parsed)) saved = parsed.filter(isChainConfig).map(withValidExplorers)
  } catch {
    // Use the defaults.
  }
  const builtIn = DEFAULT_CHAINS.map((chain) => {
    const edit = saved.find((other) => other.id === chain.id && !other.custom)
    if (!edit) return chain
    const merged = { ...edit }
    for (const field of EXPLORER_FIELDS) {
      if (merged[field] === undefined && chain[field] !== undefined) merged[field] = chain[field]
    }
    return merged
  })
  const custom = saved.filter((chain) => chain.custom && !DEFAULT_CHAINS.some((other) => other.id === chain.id))
  return [...builtIn, ...custom]
}
