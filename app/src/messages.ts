// What the Rust side sends to the webview. Types only.
// Mirrors `Snapshot`, `ConnectionInfo`, and `SigningRequest` in
// src-tauri/src/link.rs, and `Installed` in src-tauri/src/host_manifest.rs.

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
  // Milliseconds since the Unix epoch.
  receivedAt: number
  // The answer of the wallet, when it is known.
  outcome: 'fulfilled' | 'rejected' | null
}
