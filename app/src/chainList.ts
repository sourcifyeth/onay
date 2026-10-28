// The chains that the app knows: the built-in chains with their defaults,
// and the merge of a saved list with them. No platform calls in here, so
// the tests run it as it is.

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
  // Why a built-in chain runs in RPC mode. The settings show it.
  notice?: string
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
//
// The execution endpoint of a Helios chain must answer eth_getProof for
// blocks a few behind its head, because Helios asks at its own head, which
// lags the node. Publicnode serves proofs for the newest block only, so it
// is not used here. Checked on 2026-10-08: dRPC and Tenderly serve proofs
// at least 10 blocks back.
//
// Sepolia runs in RPC mode since its Glamsterdam fork (Gloas, 2026-10-06).
// The Lighthouse node behind publicnode makes no light-client data for
// Gloas blocks, so it answers 404 to every bootstrap. Lighthouse got the
// Gloas light-client types on 2026-10-20, but no release carries them yet.
// Helios 0.12.0 did not sync from https://lodestar-sepolia.chainsafe.io
// either, which serves the data; that cause is open. Checked on
// 2026-10-21, see issue #35. Before Sepolia goes back to Helios mode, a
// consensus endpoint must pass a sync in the app. Endpoints to try: the
// Lodestar node above, http://unstable.sepolia.beacon-api.nimbus.team, and
// https://sepolia.lightclient.xyz.
export const DEFAULT_CHAINS: ChainConfig[] = [
  {
    id: 1,
    name: 'Ethereum mainnet',
    mode: 'helios',
    executionRpc: 'https://eth.drpc.org',
    consensusRpc: 'https://ethereum-beacon-api.publicnode.com',
  },
  {
    id: 11155111,
    name: 'Sepolia',
    mode: 'rpc',
    executionRpc: 'https://sepolia.gateway.tenderly.co',
    notice:
      'Helios does not run on Sepolia for now. Since the Glamsterdam fork of 2026-10-06, Helios 0.12.0 syncs from no public Sepolia beacon node that we know of. The answers come from the endpoint without a check.',
  },
  {
    id: 560048,
    name: 'Hoodi',
    mode: 'helios',
    executionRpc: 'https://hoodi.drpc.org',
    consensusRpc: 'https://ethereum-hoodi-beacon-api.publicnode.com',
  },
  { id: 42161, name: 'Arbitrum One', mode: 'rpc', executionRpc: 'https://arb1.arbitrum.io/rpc' },
]

// The built-in chains with the saved edits, then the chains that the user
// added. The user edits the endpoints of a built-in chain, and nothing
// else: its name, mode and notice come from the defaults. A built-in chain
// whose mode changed gets the consensus endpoint of the defaults too.
export function mergeChains(saved: unknown): ChainConfig[] {
  const list = Array.isArray(saved) ? saved.filter(isChainConfig) : []
  const builtIn = DEFAULT_CHAINS.map((chain) => {
    const own = list.find((other) => other.id === chain.id && !other.custom)
    if (!own) return chain
    const merged: ChainConfig = { ...chain, executionRpc: own.executionRpc }
    if (chain.mode === 'helios' && own.mode === 'helios' && own.consensusRpc !== undefined) {
      merged.consensusRpc = own.consensusRpc
    }
    return merged
  })
  const custom = list.filter((chain) => chain.custom && !DEFAULT_CHAINS.some((other) => other.id === chain.id))
  return [...builtIn, ...custom]
}

export function isChainConfig(value: unknown): value is ChainConfig {
  const chain = value as Partial<ChainConfig> | null
  return (
    typeof chain?.id === 'number' &&
    typeof chain.name === 'string' &&
    (chain.mode === 'helios' || chain.mode === 'rpc') &&
    typeof chain.executionRpc === 'string' &&
    (chain.consensusRpc === undefined || typeof chain.consensusRpc === 'string')
  )
}
