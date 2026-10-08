// Service worker. It owns the link to the app and passes on each signing
// request that a page script reports. The wallet gets the same request at
// the same time: nothing here delays or changes it.

import { Inbox } from './inbox.ts'
import { Link } from './link.ts'
import { Pending } from './pending.ts'
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
// The request IDs seen per document: a page cannot repeat one.
const inbox = new Inbox()
// The requests the wallet did not answer yet. They set the badge on the
// icon and open the window that tells the user to check the app.
const pending = new Pending()
// The window that tells the user about a request, or asks to open the app
// or to pair.
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
  const update = statusUpdate(status)
  for (const port of statusPorts) port.postMessage(update)
  void chrome.action.setBadgeText({ text: badgeText(update.pending.count) })
  void updatePrompt(status)
}

function statusUpdate(status: LinkStatus): StatusUpdate {
  const latest = pending.latest()
  return {
    status,
    waiting: waiting.length,
    pending: { count: pending.count(), latest: latest ? { origin: latest.origin, method: latest.method } : null },
  }
}

function badgeText(count: number): string {
  if (count === 0) return ''
  return count > 9 ? '9+' : String(count)
}

// The window opens when a new signing request arrives, and when the user
// must do something: pair, or open the app because a request waits for
// it. It closes when the wallet answered and nothing else is needed. A
// window the user closed stays closed until the next request.
async function updatePrompt(status: LinkStatus) {
  const mustAct = status.state === 'pairing' || (status.state === 'unavailable' && waiting.length > 0)
  const open = mustAct || pending.unshown()
  const keep = mustAct || pending.count() > 0
  if (open && promptWindow === null) {
    // Reserve the slot first: two calls must not open two windows.
    promptWindow = chrome.windows.WINDOW_ID_NONE
    const created = await chrome.windows.create({ url: 'popup.html', type: 'popup', width: 420, height: 440 })
    promptWindow = created?.id ?? null
  }
  if (promptWindow !== null) pending.markShown()
  if (!keep && promptWindow !== null && promptWindow !== chrome.windows.WINDOW_ID_NONE) {
    const id = promptWindow
    promptWindow = null
    await chrome.windows.remove(id).catch(() => {})
  }
}

// The user closed the window. If it asked to open the app, the waiting
// requests are dropped.
chrome.windows.onRemoved.addListener((id) => {
  if (id !== promptWindow) return
  promptWindow = null
  if (link.status.state === 'unavailable') waiting.length = 0
})

// Sends a request or an outcome to the app, or keeps it until the app is
// there. The focus message takes another path: it is never kept.
function deliver(message: Exclude<ClientMessage, { type: 'focus' }>) {
  if (message.type === 'request') {
    pending.add(message.id, { origin: message.origin, method: message.method, at: Date.now() })
  } else {
    pending.settle(message.id)
  }
  if (link.send(message)) {
    onStatus(link.status)
    return
  }
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

// The wallet gives the chain ID as a hex string. Other values give null.
function parseChainId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,14}$/.test(value)) return null
  const chainId = Number(value)
  return Number.isSafeInteger(chainId) && chainId > 0 ? chainId : null
}

// Messages from content.ts. A page can forge them, so check each field.
// The origin comes from the browser, not from the page.
chrome.runtime.onMessage.addListener((raw: unknown, sender) => {
  if (typeof raw !== 'object' || raw === null) return
  const message = raw as Record<string, unknown>
  const origin = sender.origin ?? ''
  const document = `${sender.tab?.id}:${sender.documentId ?? sender.frameId}`
  if (typeof message.id !== 'string' || message.id.length > 32) return
  const id = `${document}:${message.id}`

  if (message.onay === 'request') {
    if (typeof message.method !== 'string' || !SIGNING_METHODS.has(message.method)) return
    const chainId = message.method === 'eth_sendTransaction' ? parseChainId(message.chainId) : null
    const request: ClientMessage = {
      type: 'request',
      id,
      origin,
      method: message.method,
      params: message.params,
      chainId,
    }
    if (JSON.stringify(request).length > MAX_REQUEST_CHARS) return
    if (!inbox.accept(document, message.id)) return
    deliver(request)
  } else if (message.onay === 'settled' && isOutcome(message.outcome)) {
    if (!inbox.known(document, message.id)) return
    deliver({ type: 'settled', id, outcome: message.outcome })
  }
})

// The documents of a closed tab are gone. Their IDs can go too.
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const document of inbox.documents()) {
    if (document.startsWith(`${tabId}:`)) inbox.forget(document)
  }
})

// The status page (popup.ts).
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'status') return
  statusPorts.add(port)
  port.onDisconnect.addListener(() => statusPorts.delete(port))
  port.onMessage.addListener((action: StatusAction) => {
    if (action.type === 'retry') link.start()
    if (action.type === 'focus') link.send({ type: 'focus' })
  })
  port.postMessage(statusUpdate(link.status))
})

void chrome.action.setBadgeBackgroundColor({ color: '#2b50aa' })

// Connect when the service worker starts, so the pairing can happen
// before the first signing request.
link.start()
