// Service worker. It owns the link to the app and passes on each signing
// request that a page script reports. The wallet gets the same request at
// the same time: nothing here delays or changes it.

import { Link } from './link.ts'
import type { ClientMessage, LinkStatus, Outcome, StatusAction, StatusUpdate } from './messages.ts'
import { openStore } from './store.ts'

// Must match HOST_NAME in app/ipc/src/lib.rs.
const HOST_NAME = 'dev.sourcify.onay'
// Must match the list in inpage.ts.
const SIGNING_METHODS = new Set([
  'eth_sendTransaction',
  'eth_signTransaction',
  'wallet_sendCalls',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'personal_sign',
  'eth_sign',
])
// A request must fit into one native message of 1 MiB after sealing and
// base64 encoding.
const MAX_REQUEST_CHARS = 600 * 1024
const MAX_WAITING = 20
// A request that waited longer is of no use to the user.
const MAX_WAIT_MS = 5 * 60 * 1000

type Waiting = { message: Extract<ClientMessage, { type: 'request' }>; since: number }

// Requests that the app did not get yet.
const waiting: Waiting[] = []
const statusPorts = new Set<chrome.runtime.Port>()
// The window that asks the user to open the app or to pair.
let promptWindow: number | null = null

const link = new Link({
  connect: () => chrome.runtime.connectNative(HOST_NAME),
  lastError: () => chrome.runtime.lastError?.message,
  store: openStore(),
  onStatus,
})

function onStatus(status: LinkStatus) {
  if (status.state === 'ready') {
    const now = Date.now()
    for (const { message, since } of waiting.splice(0)) {
      if (now - since <= MAX_WAIT_MS) link.send(message)
    }
  }
  const update: StatusUpdate = { status, waiting: waiting.length }
  for (const port of statusPorts) port.postMessage(update)
  void updatePrompt(status)
}

// The window is open while the user must do something: pair, or open the
// app because a request waits for it.
async function updatePrompt(status: LinkStatus) {
  const needed = status.state === 'pairing' || (status.state === 'unavailable' && waiting.length > 0)
  if (needed && promptWindow === null) {
    // Reserve the slot first: two calls must not open two windows.
    promptWindow = chrome.windows.WINDOW_ID_NONE
    const created = await chrome.windows.create({ url: 'popup.html', type: 'popup', width: 420, height: 400 })
    promptWindow = created?.id ?? null
  } else if (!needed && promptWindow !== null && promptWindow !== chrome.windows.WINDOW_ID_NONE) {
    const id = promptWindow
    promptWindow = null
    await chrome.windows.remove(id).catch(() => {})
  }
}

// The user closed the window: the waiting requests are dropped.
chrome.windows.onRemoved.addListener((id) => {
  if (id !== promptWindow) return
  promptWindow = null
  waiting.length = 0
})

function deliver(message: ClientMessage) {
  if (link.send(message)) return
  if (message.type === 'request') {
    waiting.push({ message, since: Date.now() })
    if (waiting.length > MAX_WAITING) waiting.shift()
  } else {
    // The wallet answered before the app saw the request. Drop the request.
    const index = waiting.findIndex((entry) => entry.message.id === message.id)
    if (index !== -1) waiting.splice(index, 1)
  }
  link.start()
  onStatus(link.status)
}

function isOutcome(value: unknown): value is Outcome {
  return value === 'fulfilled' || value === 'rejected'
}

// Messages from content.ts. A page can forge them, so check each field.
// The origin comes from the browser, not from the page.
chrome.runtime.onMessage.addListener((raw: unknown, sender) => {
  if (typeof raw !== 'object' || raw === null) return
  const message = raw as Record<string, unknown>
  const origin = sender.origin ?? ''
  const document = sender.documentId ?? `${sender.tab?.id}.${sender.frameId}`
  if (typeof message.id !== 'string' || message.id.length > 32) return
  const id = `${document}:${message.id}`

  if (message.onay === 'request') {
    if (typeof message.method !== 'string' || !SIGNING_METHODS.has(message.method)) return
    const request: ClientMessage = { type: 'request', id, origin, method: message.method, params: message.params }
    if (JSON.stringify(request).length > MAX_REQUEST_CHARS) return
    deliver(request)
  } else if (message.onay === 'settled' && isOutcome(message.outcome)) {
    deliver({ type: 'settled', id, outcome: message.outcome })
  }
})

// The status page (popup.ts).
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'status') return
  statusPorts.add(port)
  port.onDisconnect.addListener(() => statusPorts.delete(port))
  port.onMessage.addListener((action: StatusAction) => {
    if (action.type === 'retry') link.start()
  })
  port.postMessage({ status: link.status, waiting: waiting.length } satisfies StatusUpdate)
})

// Connect when the service worker starts, so the pairing can happen
// before the first signing request.
link.start()
