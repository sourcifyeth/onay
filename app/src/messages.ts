// What the Rust side sends to the webview. Types only.
// Mirrors `Snapshot`, `ConnectionInfo`, `SigningRequest`, and
// `RequestSource` in src-tauri/src/link.rs, and `Installed` in
// src-tauri/src/host_manifest.rs.
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

// `open_url` in src-tauri/src/browser.rs opens a link in the browser of
// the desktop. The app allows a few sites only.
export type OpenUrlArgs = { url: string }

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
  // The browser that the peer check found: its binary on Linux, its name
  // and signature on macOS.
  browser: string
  // Set while the user must approve this extension.
  pairingCode: string | null
}

// Where a request came from: a page, through the extension, or the user,
// who pasted it into the app.
export type RequestSource = 'browser' | 'paste'

export type SigningRequest = {
  // 0 for a pasted request.
  connection: number
  id: string
  source: RequestSource
  // The site. Empty for a pasted request.
  origin: string
  method: string
  params: unknown
  // Not verified: the page reports it. Set only for eth_sendTransaction.
  chainId: number | null
  // Milliseconds since the Unix epoch.
  receivedAt: number
  // The answer of the wallet, when it is known.
  outcome: 'fulfilled' | 'rejected' | null
  // Set for a pasted raw transaction that carries its signature. Its
  // sender comes from the signature.
  signed: boolean
}

// `add_request` adds a request that the user pasted into the app.
export type AddRequestArgs = { method: string; params: unknown; signed: boolean }
