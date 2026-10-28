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
// Sepolia activated Glamsterdam (Gloas) on 2026-10-06. Checked on
// 2026-10-28, see issue #35:
// - publicnode runs Lighthouse 8.3.1, which makes no light-client data for
//   Gloas blocks. It answers 404 to every bootstrap.
// - Lodestar serves the Gloas data, and Helios syncs from it. Lodestar
//   changes the finality update once per epoch only, as the spec says, so
//   the head of Helios 0.12.0 falls up to 6 minutes behind. Helios needs
//   the optimistic update for a recent head.
// - unstable.sepolia.beacon-api.nimbus.team has no DNS record, and
//   sepolia.lightclient.xyz closes the connection.
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
    mode: 'helios',
    executionRpc: 'https://sepolia.gateway.tenderly.co',
    consensusRpc: 'https://lodestar-sepolia.chainsafe.io',
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

// Endpoints that were a default once, by chain id. The app saves the whole
// list, so a saved chain can hold one that the user never chose.
const RETIRED_CONSENSUS_RPCS: Record<number, string[]> = {
  11155111: ['https://ethereum-sepolia-beacon-api.publicnode.com'],
}

// The built-in chains with the saved edits, then the chains that the user
// added. A built-in chain of a newer version shows up with its defaults, and
// a retired default endpoint changes to the current one.
export function mergeChains(saved: unknown): ChainConfig[] {
  const list = Array.isArray(saved) ? saved.filter(isChainConfig) : []
  const builtIn = DEFAULT_CHAINS.map((chain) => {
    const own = list.find((other) => other.id === chain.id && !other.custom)
    if (!own) return chain
    const retired = RETIRED_CONSENSUS_RPCS[chain.id] ?? []
    if (own.consensusRpc !== undefined && retired.includes(own.consensusRpc)) {
      return { ...own, consensusRpc: chain.consensusRpc }
    }
    return own
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
