// Popup: one button that asks the service worker to ping the app.

const button = document.querySelector<HTMLButtonElement>('#ping')!
const result = document.querySelector<HTMLPreElement>('#result')!

button.addEventListener('click', async () => {
  const started = performance.now()
  result.textContent = 'pinging...'
  const reply: unknown = await chrome.runtime.sendMessage({ type: 'ping' })
  const ms = Math.round(performance.now() - started)
  result.textContent = `${JSON.stringify(reply)} (${ms} ms)`
})
