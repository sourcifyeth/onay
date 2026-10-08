// Status page. It is the toolbar popup, and the service worker also opens
// it as a window when the user must open the app or confirm a pairing.

import type { LinkStatus, StatusAction, StatusUpdate } from './messages.ts'

const RETRY_MS = 2000

const title = document.querySelector<HTMLElement>('#title')!
const detail = document.querySelector<HTMLElement>('#detail')!
const code = document.querySelector<HTMLElement>('#code')!
const waiting = document.querySelector<HTMLElement>('#waiting')!
const request = document.querySelector<HTMLElement>('#request')!
const linkCard = document.querySelector<HTMLElement>('main')!
const requestTitle = document.querySelector<HTMLElement>('#request-title')!
const requestDetail = document.querySelector<HTMLElement>('#request-detail')!
const open = document.querySelector<HTMLButtonElement>('#open')!

// What the site asked for, in plain words.
function describeMethod(method: string): string {
  switch (method) {
    case 'eth_sendTransaction':
    case 'eth_signTransaction':
      return 'a transaction'
    case 'wallet_sendCalls':
      return 'a batch of transactions'
    case 'personal_sign':
    case 'eth_sign':
      return 'a message'
    default:
      return 'typed data'
  }
}

// A heading and one sentence that says what the user can do.
function describe(status: LinkStatus): [string, string] {
  switch (status.state) {
    case 'idle':
    case 'connecting':
      return ['Connecting to the Onay app…', '']
    case 'ready':
      return [
        'Connected to the Onay app',
        'When a site asks your wallet to sign, the app shows you the request. Your wallet gets it at the same time.',
      ]
    case 'pairing':
      return [
        'Pair this extension with the app',
        'The Onay app shows a code. If it is the same as this one, approve the pairing in the app.',
      ]
    case 'unavailable':
      switch (status.reason) {
        case 'not-installed':
          return ['The Onay app is not installed', 'Install the app and start it. This page connects by itself.']
        case 'not-running':
          return ['The Onay app is not running', 'Start the app. This page connects by itself.']
        case 'refused':
          return ['The Onay app refused the connection', status.message]
      }
  }
}

let status: LinkStatus = { state: 'idle' }

function show(update: StatusUpdate) {
  showPending(update.pending)
  showWaiting(update.waiting)
  // A retry is not news. Keep the old text until the retry has a result.
  if (status.state === 'unavailable' && update.status.state === 'connecting') return
  status = update.status
  const [heading, text] = describe(status)
  document.body.dataset.state = status.state === 'idle' ? 'connecting' : status.state
  title.textContent = heading
  detail.textContent = text
  code.textContent = status.state === 'pairing' ? status.code : ''
  // With a request on screen, the link card matters only when the link is
  // not ready: then the user must do something about it.
  linkCard.hidden = update.pending.latest !== null && status.state === 'ready'
  // The app can be brought to the front only while it is connected.
  open.hidden = status.state !== 'ready'
}

// The newest request that the wallet did not answer yet.
function showPending({ count, latest }: StatusUpdate['pending']) {
  request.hidden = latest === null
  if (!latest) return
  requestTitle.textContent = `${latest.origin} asks your wallet to sign ${describeMethod(latest.method)}`
  requestDetail.textContent =
    (count > 1 ? `${count} requests are open. ` : '') +
    'Check the request in the Onay app before you confirm it in your wallet.'
}

function showWaiting(count: number) {
  waiting.textContent =
    count === 0
      ? ''
      : count === 1
        ? 'One signing request waits for the app. Your wallet has it already.'
        : `${count} signing requests wait for the app. Your wallet has them already.`
}

const port = chrome.runtime.connect({ name: 'status' })
port.onMessage.addListener(show)
open.addEventListener('click', () => port.postMessage({ type: 'focus' } satisfies StatusAction))

// Try again while the app is not there. This also keeps the service
// worker awake.
setInterval(() => {
  if (status.state === 'unavailable') port.postMessage({ type: 'retry' } satisfies StatusAction)
}, RETRY_MS)
