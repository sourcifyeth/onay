// Page script. It runs in the page itself, before the page's own scripts,
// and watches the wallet providers (EIP-1193). When the page asks a wallet
// to sign, this script reports a copy of the request. The call to the
// wallet is not delayed and not changed.
//
// The page can see and change everything here. Nothing in this file is a
// security boundary. It is a plain script, not a module: no imports, no
// exports, and no dependencies.
;(() => {
  type PageMessage = import('./messages.ts').PageMessage
  type Outcome = import('./messages.ts').Outcome
  type Method = (this: unknown, ...args: unknown[]) => unknown

  // Must match the list in background.ts.
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

  // Taken now, before a page script can replace it.
  const post = window.postMessage.bind(window)
  const targetOrigin = window.location.origin === 'null' ? '*' : window.location.origin
  const watched = new WeakSet<object>()
  let count = 0

  function tell(message: PageMessage) {
    try {
      post(message, targetOrigin)
    } catch {
      // A failure here must never reach the page.
    }
  }

  // Reports the request if it asks for a signature. Returns its ID.
  function report(method: unknown, params: unknown): string | null {
    if (typeof method !== 'string' || !SIGNING_METHODS.has(method)) return null
    let plain: unknown = null
    try {
      // Only plain data can cross to the extension.
      plain = JSON.parse(JSON.stringify(params ?? null))
    } catch {
      // Report the request without its parameters.
    }
    const id = String(++count)
    tell({ onay: 'request', id, method, params: plain })
    return id
  }

  // Reports each request in a JSON-RPC payload, single or batch.
  function reportPayload(payload: unknown): string[] {
    const requests = Array.isArray(payload) ? payload : [payload]
    const ids: string[] = []
    for (const request of requests) {
      if (typeof request !== 'object' || request === null) continue
      const id = report((request as { method?: unknown }).method, (request as { params?: unknown }).params)
      if (id !== null) ids.push(id)
    }
    return ids
  }

  function settle(ids: string[], outcome: Outcome) {
    for (const id of ids) tell({ onay: 'settled', id, outcome })
  }

  // Reports how the wallet answers. The page gets the same result object.
  function watchResult(ids: string[], result: unknown): unknown {
    const then = (result as { then?: unknown } | null)?.then
    if (ids.length > 0 && typeof then === 'function') {
      Reflect.apply(then, result, [() => settle(ids, 'fulfilled'), () => settle(ids, 'rejected')])
    }
    return result
  }

  function hasError(response: unknown): boolean {
    const responses = Array.isArray(response) ? response : [response]
    return responses.some(
      (entry) => typeof entry === 'object' && entry !== null && Boolean((entry as { error?: unknown }).error),
    )
  }

  // A callback that reports the answer and then calls the page's callback.
  function watchCallback(ids: string[], callback: Method): Method {
    return function (this: unknown, ...args: unknown[]) {
      settle(ids, args[0] || hasError(args[1]) ? 'rejected' : 'fulfilled')
      return Reflect.apply(callback, this, args)
    }
  }

  function replace(provider: Record<string, unknown>, name: string, make: (original: Method) => Method) {
    const original = provider[name]
    if (typeof original !== 'function') return
    try {
      Object.defineProperty(provider, name, { value: make(original as Method), configurable: true, writable: true })
    } catch {
      // A frozen provider cannot be watched.
    }
  }

  // Replaces the three call methods of a provider. The replacement is on
  // the provider object itself, so each reference to the provider sees it.
  function watch(candidate: unknown) {
    if (typeof candidate !== 'object' || candidate === null || watched.has(candidate)) return
    watched.add(candidate)
    const provider = candidate as Record<string, unknown>

    // request({ method, params }): the EIP-1193 call.
    replace(
      provider,
      'request',
      (original) =>
        function (this: unknown, ...args: unknown[]) {
          const ids = reportPayload(args[0])
          return watchResult(ids, Reflect.apply(original, this, args))
        },
    )

    // sendAsync(payload, callback): the older call.
    replace(
      provider,
      'sendAsync',
      (original) =>
        function (this: unknown, ...args: unknown[]) {
          const ids = reportPayload(args[0])
          if (ids.length > 0 && typeof args[1] === 'function') args[1] = watchCallback(ids, args[1] as Method)
          return Reflect.apply(original, this, args)
        },
    )

    // send: the oldest call. It is send(method, params), or
    // send(payload, callback), or send(payload).
    replace(
      provider,
      'send',
      (original) =>
        function (this: unknown, ...args: unknown[]) {
          if (typeof args[0] === 'string') {
            const id = report(args[0], args[1])
            return watchResult(id === null ? [] : [id], Reflect.apply(original, this, args))
          }
          const ids = reportPayload(args[0])
          if (ids.length > 0 && typeof args[1] === 'function') {
            args[1] = watchCallback(ids, args[1] as Method)
            return Reflect.apply(original, this, args)
          }
          return watchResult(ids, Reflect.apply(original, this, args))
        },
    )
  }

  function watchGlobal() {
    try {
      watch((window as { ethereum?: unknown }).ethereum)
    } catch {
      // A failure here must never reach the page.
    }
  }

  // Wallets put their provider on window.ethereum, and they announce it
  // with an EIP-6963 event. The order of the scripts is not fixed, so look
  // at each moment a provider can appear.
  watchGlobal()
  window.addEventListener('ethereum#initialized', watchGlobal)
  document.addEventListener('DOMContentLoaded', watchGlobal)
  window.addEventListener('load', watchGlobal)
  window.addEventListener(
    'eip6963:announceProvider',
    (event) => {
      try {
        watch((event as CustomEvent<{ provider?: unknown } | null>).detail?.provider)
      } catch {
        // A failure here must never reach the page.
      }
    },
    true,
  )
  // Ask the wallets that are ready to announce themselves now.
  window.dispatchEvent(new Event('eip6963:requestProvider'))
})()
