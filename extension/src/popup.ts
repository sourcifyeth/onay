// Status page. It is the toolbar popup, and the service worker also opens
// it as a window when the user must open the app or confirm a pairing.

import type { LinkStatus, StatusAction, StatusUpdate } from './messages.ts'

const RETRY_MS = 2000

const title = document.querySelector<HTMLElement>('#title')!
const detail = document.querySelector<HTMLElement>('#detail')!
const code = document.querySelector<HTMLElement>('#code')!
const waiting = document.querySelector<HTMLElement>('#waiting')!

function describe(status: LinkStatus): [string, string] {
  switch (status.state) {
    case 'idle':
    case 'connecting':
      return ['Connecting to the Onay app...', '']
    case 'ready':
      return ['Connected to the Onay app.', 'The app shows each signing request. Your wallet gets it at the same time.']
    case 'pairing':
      return [
        'Pair with the Onay app',
        'Make sure that the Onay app shows this code. Then approve the pairing in the app.',
      ]
    case 'unavailable':
      if (status.reason === 'not-installed') {
        return ['The Onay app is not installed.', 'Install the app and start it once. This page connects by itself.']
      }
      if (status.reason === 'not-running') {
        return ['The Onay app is not running.', 'Start the app. This page connects by itself.']
      }
      return ['The Onay app refused the connection.', status.message]
  }
}

let status: LinkStatus = { state: 'idle' }

function show(update: StatusUpdate) {
  status = update.status
  const [heading, text] = describe(status)
  title.textContent = heading
  detail.textContent = text
  code.textContent = status.state === 'pairing' ? status.code : ''
  waiting.textContent =
    update.waiting > 0 ? `${update.waiting} signing request(s) wait for the app. Your wallet has them already.` : ''
}

const port = chrome.runtime.connect({ name: 'status' })
port.onMessage.addListener(show)

// Try again while the app is not there. This also keeps the service
// worker awake.
setInterval(() => {
  if (status.state === 'unavailable') port.postMessage({ type: 'retry' } satisfies StatusAction)
}, RETRY_MS)
