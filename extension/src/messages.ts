// Every message the extension sends or receives. Types only: this file
// compiles to nothing.

// ---- Page script to content script to service worker ----

// From inpage.ts, by window.postMessage. The page can forge these, so the
// service worker checks each field. `id` is a counter per page; a `settled`
// message names the `request` it belongs to.
export type PageMessage =
  | { onay: 'request'; id: string; method: string; params: unknown }
  | { onay: 'settled'; id: string; outcome: Outcome }

// How the wallet answered the page.
export type Outcome = 'fulfilled' | 'rejected'

// ---- Service worker to app, through the relay ----
// Mirrors `ClientFrame`, `ServerFrame`, `ClientMessage`, and
// `ServerMessage` in app/src-tauri/src/link.rs.

// In the clear.
export type ClientFrame =
  | { type: 'hello'; version: number; publicKey: string; salt: string }
  | { type: 'sealed'; data: string }

// In the clear. The relay sends the error form when the app is not running.
export type ServerFrame =
  | { type: 'hello'; version: number; publicKey: string; salt: string; paired: boolean }
  | { type: 'sealed'; data: string }
  | { type: 'error'; message: string }

// Inside a sealed frame. `id` is the page counter with the browser's ID of
// the document in front, so requests of different tabs never collide.
export type ClientMessage =
  | { type: 'request'; id: string; origin: string; method: string; params: unknown }
  | { type: 'settled'; id: string; outcome: Outcome }

// Inside a sealed frame.
export type ServerMessage = { type: 'paired' } | { type: 'pairing-rejected' }

// ---- Service worker to status page (popup.ts) ----

export type LinkStatus =
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'pairing'; code: string }
  | { state: 'ready' }
  | { state: 'unavailable'; reason: 'not-installed' | 'not-running' | 'refused'; message: string }

// `waiting` is the number of signing requests that the app did not get yet.
export type StatusUpdate = { status: LinkStatus; waiting: number }

export type StatusAction = { type: 'retry' }
