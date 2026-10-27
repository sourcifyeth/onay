// A small client of the W3C WebDriver protocol: one session, scripts in
// the page, a reload, nothing else. The transport comes in as a
// parameter, so a test gives a fake. No dependencies, like the rest of
// the package.

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export class WebDriverError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'WebDriverError'
    this.code = code
  }
}

// One call of the protocol: the `value` of the answer, or the error that
// the answer carries.
async function call(fetch: Fetch, url: string, method: string, body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let answer: { value?: unknown }
  try {
    answer = JSON.parse(text) as { value?: unknown }
  } catch {
    throw new WebDriverError(
      'invalid response',
      `${method} ${url} answered HTTP ${response.status}: ${text.slice(0, 200)}`,
    )
  }
  if (!response.ok) {
    const error = answer.value as { error?: string; message?: string } | undefined
    throw new WebDriverError(error?.error ?? 'unknown error', `${method} ${url}: ${error?.message ?? text}`)
  }
  return answer.value
}

export class Session {
  private readonly fetch: Fetch
  private readonly url: string

  private constructor(fetch: Fetch, url: string) {
    this.fetch = fetch
    this.url = url
  }

  // Starts a session. The capabilities go under `alwaysMatch`.
  static async open(server: string, capabilities: Record<string, unknown>, fetch: Fetch = globalThis.fetch) {
    const value = (await call(fetch, `${server}/session`, 'POST', {
      capabilities: { alwaysMatch: capabilities },
    })) as { sessionId?: unknown } | null
    if (typeof value?.sessionId !== 'string') throw new WebDriverError('invalid response', 'the session has no ID')
    return new Session(fetch, `${server}/session/${value.sessionId}`)
  }

  // Runs `script` in the page as the body of an async function and
  // returns what it resolves to. The script reads `args` as `arguments`.
  // An error is sent back as data: the driver reports a rejection badly.
  async execute<T>(script: string, args: unknown[] = []): Promise<T> {
    const wrapped = `const done = arguments[arguments.length - 1];
      (async () => { ${script} })().then(
        (value) => done({ value }),
        (error) => done({ error: String(error && error.stack ? error.stack : error) }),
      )`
    const result = (await call(this.fetch, `${this.url}/execute/async`, 'POST', { script: wrapped, args })) as {
      value?: T
      error?: string
    } | null
    if (result?.error !== undefined) throw new Error(`the page script failed: ${result.error}`)
    return result?.value as T
  }

  // Reloads the page and waits for the load.
  refresh(): Promise<unknown> {
    return call(this.fetch, `${this.url}/refresh`, 'POST', {})
  }

  // Ends the session, which closes the app.
  close(): Promise<unknown> {
    return call(this.fetch, this.url, 'DELETE')
  }
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Waits until the server answers its status call.
export async function waitForServer(
  server: string,
  timeout: number,
  fetch: Fetch = globalThis.fetch,
  sleep = pause,
): Promise<void> {
  const deadline = Date.now() + timeout
  for (;;) {
    try {
      const response = await fetch(`${server}/status`)
      if (response.ok) return
    } catch {
      // Not listening yet.
    }
    if (Date.now() >= deadline) throw new Error(`no WebDriver server at ${server} after ${timeout} ms`)
    await sleep(200)
  }
}

// Polls `read` until it gives a value, or the time is up.
export async function waitFor<T>(
  read: () => Promise<T | null | false>,
  timeout: number,
  what: string,
  sleep = pause,
  interval = 1000,
): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await read()
    if (value !== null && value !== false) return value
    if (Date.now() >= deadline) throw new Error(`${what} did not come within ${timeout / 1000} s`)
    await sleep(interval)
  }
}
