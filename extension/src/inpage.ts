// Page script. It runs in the page itself, before the page's own scripts,
// and watches the wallet providers (EIP-1193). When the page asks a wallet
// to sign, this script reports a copy of the request. The call to the
// wallet is not delayed and not changed.
//
// The page can see and change everything here. Nothing in this file is a
// security boundary. It is a plain script, not a module: no imports, no
// exports, and no dependencies.
//
// For eth_sendTransaction, the report also has the chain of the wallet.
// The script asks the wallet for it just before the call. Only the report
// waits for the answer, not the call.
;(() => {
  type PageMessage = import('./messages.ts').PageMessage
  type Outcome = import('./messages.ts').Outcome
  type Method = (this: unknown, ...args: unknown[]) => unknown
  // A reported request. `sent` is set while the report waits for the chain.
  type Report = { id: string; sent: Promise<void> | null }

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
  const CHAIN_ID_TIMEOUT_MS = 2000

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

  // Asks the wallet for its chain. Gives null if no answer comes in time.
  function askChainId(provider: object, request: Method | null): Promise<string | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), CHAIN_ID_TIMEOUT_MS)
      const done = (chainId: unknown) => {
        clearTimeout(timer)
        resolve(typeof chainId === 'string' ? chainId : null)
      }
      try {
        if (!request) return done(null)
        Promise.resolve(Reflect.apply(request, provider, [{ method: 'eth_chainId' }])).then(done, () => done(null))
      } catch {
        done(null)
      }
    })
  }

  // Reports the request if it asks for a signature.
  function report(method: unknown, params: unknown, chain: () => Promise<string | null>): Report | null {
    if (typeof method !== 'string' || !SIGNING_METHODS.has(method)) return null
    let plain: unknown = null
    try {
      // Only plain data can cross to the extension.
      plain = JSON.parse(JSON.stringify(params ?? null))
    } catch {
      // Report the request without its parameters.
    }
    const id = String(++count)
    if (method !== 'eth_sendTransaction') {
      tell({ onay: 'request', id, method, params: plain, chainId: null })
      return { id, sent: null }
    }
    const sent = chain().then((chainId) => tell({ onay: 'request', id, method, params: plain, chainId }))
    return { id, sent }
  }

  // Reports each request in a JSON-RPC payload, single or batch. All
  // requests of one payload share one chain query.
  function reportPayload(payload: unknown, askChain: () => Promise<string | null>): Report[] {
    let chainId: Promise<string | null> | null = null
    const once = () => (chainId ??= askChain())
    const requests = Array.isArray(payload) ? payload : [payload]
    const reports: Report[] = []
    for (const request of requests) {
      if (typeof request !== 'object' || request === null) continue
      const reported = report((request as { method?: unknown }).method, (request as { params?: unknown }).params, once)
      if (reported !== null) reports.push(reported)
    }
    return reports
  }

  // The settled message never comes before its request.
  function settle(reports: Report[], outcome: Outcome) {
    for (const { id, sent } of reports) {
      const message: PageMessage = { onay: 'settled', id, outcome }
      if (sent) sent.then(() => tell(message))
      else tell(message)
    }
  }

  // Calls the wallet. A call that throws is reported as rejected.
  function call(reports: Report[], original: Method, self: unknown, args: unknown[]): unknown {
    try {
      return Reflect.apply(original, self, args)
    } catch (error) {
      settle(reports, 'rejected')
      throw error
    }
  }

  // Reports how the wallet answers. The page gets the same result object.
  function watchResult(reports: Report[], result: unknown): unknown {
    if (reports.length === 0) return result
    const then = (result as { then?: unknown } | null)?.then
    if (typeof then === 'function') {
      Reflect.apply(then, result, [() => settle(reports, 'fulfilled'), () => settle(reports, 'rejected')])
    } else {
      // The synchronous form of send gives the response itself.
      settle(reports, hasError(result) ? 'rejected' : 'fulfilled')
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
  function watchCallback(reports: Report[], callback: Method): Method {
    return function (this: unknown, ...args: unknown[]) {
      settle(reports, args[0] || hasError(args[1]) ? 'rejected' : 'fulfilled')
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
    // Taken before the replacement, so the chain query is not reported.
    const request = typeof provider.request === 'function' ? (provider.request as Method) : null
    const askChain = () => askChainId(provider, request)

    // request({ method, params }): the EIP-1193 call.
    replace(
      provider,
      'request',
      (original) =>
        function (this: unknown, ...args: unknown[]) {
          const reports = reportPayload(args[0], askChain)
          return watchResult(reports, call(reports, original, this, args))
        },
    )

    // sendAsync(payload, callback): the older call.
    replace(
      provider,
      'sendAsync',
      (original) =>
        function (this: unknown, ...args: unknown[]) {
          const reports = reportPayload(args[0], askChain)
          if (reports.length > 0 && typeof args[1] === 'function') args[1] = watchCallback(reports, args[1] as Method)
          return call(reports, original, this, args)
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
            const reported = report(args[0], args[1], askChain)
            const reports = reported === null ? [] : [reported]
            return watchResult(reports, call(reports, original, this, args))
          }
          const reports = reportPayload(args[0], askChain)
          if (reports.length > 0 && typeof args[1] === 'function') {
            args[1] = watchCallback(reports, args[1] as Method)
            return call(reports, original, this, args)
          }
          return watchResult(reports, call(reports, original, this, args))
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
