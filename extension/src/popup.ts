// Status page. It is the toolbar popup, and the service worker also opens
// it as a window when the user must open the app or confirm a pairing.

import type { LinkStatus, StatusAction, StatusUpdate } from './messages.ts'

const RETRY_MS = 2000

const title = document.querySelector<HTMLElement>('#title')!
const detail = document.querySelector<HTMLElement>('#detail')!
const code = document.querySelector<HTMLElement>('#code')!
const waiting = document.querySelector<HTMLElement>('#waiting')!

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
  showWaiting(update.waiting)
  // A retry is not news. Keep the old text until the retry has a result.
  if (status.state === 'unavailable' && update.status.state === 'connecting') return
  status = update.status
  const [heading, text] = describe(status)
  document.body.dataset.state = status.state === 'idle' ? 'connecting' : status.state
  title.textContent = heading
  detail.textContent = text
  code.textContent = status.state === 'pairing' ? status.code : ''
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

// Try again while the app is not there. This also keeps the service
// worker awake.
setInterval(() => {
  if (status.state === 'unavailable') port.postMessage({ type: 'retry' } satisfies StatusAction)
}, RETRY_MS)
