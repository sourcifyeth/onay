// Service worker. It owns the native messaging port to the relay, and
// through it to the app. The popup asks it to ping.

import type { AppRequest, PopupRequest, Reply } from './messages.ts'

// Must match HOST_NAME in app/ipc/src/lib.rs.
const HOST_NAME = 'dev.sourcify.onay'
const PING_TIMEOUT_MS = 5000

let port: chrome.runtime.Port | null = null
let nextId = 1
const pending = new Map<number, (reply: Reply) => void>()

function failAll(message: string) {
  for (const resolve of pending.values()) resolve({ type: 'error', message })
  pending.clear()
}

// Connects on first use. The browser starts the relay at this point.
function connect(): chrome.runtime.Port {
  if (port) return port
  const opened = chrome.runtime.connectNative(HOST_NAME)
  opened.onMessage.addListener((reply: Reply) => {
    if (reply.type === 'error') {
      failAll(reply.message)
      return
    }
    pending.get(reply.id)?.(reply)
    pending.delete(reply.id)
  })
  opened.onDisconnect.addListener(() => {
    failAll(chrome.runtime.lastError?.message ?? 'relay closed the port')
    port = null
  })
  port = opened
  return opened
}

function ping(): Promise<Reply> {
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    setTimeout(() => {
      if (pending.delete(id)) resolve({ type: 'error', message: 'no answer within 5 s' })
    }, PING_TIMEOUT_MS)
    connect().postMessage({ type: 'ping', id } satisfies AppRequest)
  })
}

chrome.runtime.onMessage.addListener((message: PopupRequest, _sender, sendResponse: (reply: Reply) => void) => {
  // The type is a promise, not a check. Ignore anything else.
  if (message.type !== 'ping') return false
  ping().then(sendResponse)
  // The answer comes later; keep the channel open.
  return true
})
