// Content script. It passes the messages of inpage.ts to the service
// worker. A page script cannot call the extension, so this script is the
// bridge. It is a plain script, not a module: no imports, no exports.
;(() => {
  type PageMessage = import('./messages.ts').PageMessage

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data as Partial<PageMessage> | null
    if (typeof data !== 'object' || data === null) return
    if (data.onay !== 'request' && data.onay !== 'settled') return
    try {
      // The service worker checks the content.
      chrome.runtime.sendMessage(data).catch(() => {})
    } catch {
      // The extension was reloaded. This page needs a reload too.
    }
  })
})()
