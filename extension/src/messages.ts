// Every message the extension sends or receives. Types only: this file
// compiles to nothing.

// Popup to service worker.
export type PopupRequest = { type: 'ping' }

// Service worker to app, through the relay. Mirrors `Request` in
// app/src-tauri/src/link.rs.
export type AppRequest = { type: 'ping'; id: number }

// App to service worker, and passed on to the popup. Mirrors `Reply` in
// app/src-tauri/src/link.rs. The relay sends the error form when the app
// is not running.
export type Reply = { type: 'pong'; id: number } | { type: 'error'; message: string }
