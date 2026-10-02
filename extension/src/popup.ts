// Popup: one button that asks the service worker to ping the app.

import type { PopupRequest, Reply } from './messages.ts'

const button = document.querySelector<HTMLButtonElement>('#ping')!
const result = document.querySelector<HTMLPreElement>('#result')!

// Error texts from Chrome and from the relay, with a readable version.
const READABLE_ERRORS: Record<string, string> = {
  'Specified native messaging host not found.':
    'The Onay app is not installed. Install it, start it once, and try again.',
  'app not running': 'The Onay app is not running. Start it and try again.',
  'Failed to start native messaging host.':
    'The Onay app was removed or is damaged. Install it again.',
  'Access to the specified native messaging host is forbidden.':
    'The Onay app does not accept this extension. The extension ID is not the expected one.',
  'no answer within 5 s': 'The Onay app did not answer in time.',
}

function describe(reply: Reply, ms: number): string {
  if (reply.type === 'pong') return `The app answered in ${ms} ms.`
  return READABLE_ERRORS[reply.message] ?? `Error: ${reply.message}`
}

button.addEventListener('click', async () => {
  const started = performance.now()
  result.textContent = 'Waiting for the app...'
  const reply = await chrome.runtime.sendMessage<PopupRequest, Reply>({ type: 'ping' })
  result.textContent = describe(reply, Math.round(performance.now() - started))
})
