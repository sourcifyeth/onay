// What the Rust side sends to the webview. Types only.
// Mirrors `Snapshot`, `ConnectionInfo`, and `SigningRequest` in
// src-tauri/src/link.rs, and `Installed` in src-tauri/src/host_manifest.rs.
// The chain types mirror the commands and `Ready` in src-tauri/src/chain.rs.

export type Hex = `0x${string}`

export type StartChainArgs = { chainId: number; consensusRpc: string; executionRpc: string }

export type StopChainArgs = { chainId: number }

export type ChainReadyArgs = { chainId: number }

// Mirrors `Ready`.
export type ChainReady = {
  // The newest verified block.
  block: number
  // The newest finalized checkpoint.
  checkpoint: Hex | null
}

// `chain_request` answers like an EIP-1193 provider.
export type ChainRequestArgs = { chainId: number; method: string; params: unknown[] }

export type Snapshot = {
  socket: string
  relay: string | null
  manifests: { path: string; error: string | null }[]
  errors: string[]
  connections: ConnectionInfo[]
  requests: SigningRequest[]
  // Why the app refused the most recent connections.
  rejected: string[]
}

export type ConnectionInfo = {
  id: number
  // The browser binary, if the peer check found it.
  browser: string | null
  verified: boolean
  // Set while the user must approve this extension.
  pairingCode: string | null
}

export type SigningRequest = {
  connection: number
  id: string
  origin: string
  method: string
  params: unknown
  // Not verified: the page reports it. Set only for eth_sendTransaction.
  chainId: number | null
  // Milliseconds since the Unix epoch.
  receivedAt: number
  // The answer of the wallet, when it is known.
  outcome: 'fulfilled' | 'rejected' | null
}
