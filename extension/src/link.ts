// The connection to the app: hello exchange, pairing, and sealed messages.
// The steps are listed at the top of app/src-tauri/src/link.rs. This file
// has no browser calls of its own, so the tests can run it with a fake
// port and a fake store.

import { VERSION, fromBase64, pairingCode, publicKeyBytes, randomSalt, session, toBase64 } from './channel.ts'
import type { Bytes, Hello, Opener, Sealer } from './channel.ts'
import type { ClientFrame, ClientMessage, LinkStatus, ServerFrame, ServerMessage } from './messages.ts'
import type { Store } from './store.ts'

// The part of chrome.runtime.Port that the link uses.
export interface NativePort {
  postMessage(message: ClientFrame): void
  disconnect(): void
  onMessage: { addListener(listener: (message: unknown) => void): void }
  onDisconnect: { addListener(listener: () => void): void }
}

export type LinkOptions = {
  // Starts the relay. In the browser: chrome.runtime.connectNative.
  connect: () => NativePort
  // Why the port closed. In the browser: chrome.runtime.lastError.
  lastError: () => string | undefined
  store: Store
  onStatus: (status: LinkStatus) => void
}

// One try to reach the app.
type Attempt = {
  port: NativePort
  extension: Hello | null
  appKey: Bytes | null
  sealer: Sealer | null
  opener: Opener | null
}

const NOT_INSTALLED = 'Specified native messaging host not found.'
const NOT_RUNNING = 'app not running'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}

function isServerFrame(value: unknown): value is ServerFrame {
  if (typeof value !== 'object' || value === null) return false
  const frame = value as Record<string, unknown>
  switch (frame.type) {
    case 'hello':
      return (
        typeof frame.version === 'number' &&
        typeof frame.publicKey === 'string' &&
        typeof frame.salt === 'string' &&
        typeof frame.paired === 'boolean'
      )
    case 'sealed':
      return typeof frame.data === 'string'
    case 'error':
      return typeof frame.message === 'string'
    default:
      return false
  }
}

export class Link {
  #options: LinkOptions
  #status: LinkStatus = { state: 'idle' }
  #attempt: Attempt | null = null
  // Frames are handled one after the other, in the order they arrive.
  #inbox: Promise<void> = Promise.resolve()

  constructor(options: LinkOptions) {
    this.#options = options
  }

  get status(): LinkStatus {
    return this.#status
  }

  // Connects if there is no connection. Safe to call at any time.
  start(): void {
    if (this.#attempt) return
    const port = this.#options.connect()
    const attempt: Attempt = { port, extension: null, appKey: null, sealer: null, opener: null }
    this.#attempt = attempt
    this.#setStatus({ state: 'connecting' })

    port.onMessage.addListener((frame) => {
      this.#inbox = this.#inbox.then(async () => {
        if (this.#attempt !== attempt) return
        try {
          await this.#receive(attempt, frame)
        } catch (error) {
          this.#fail(attempt, 'refused', `The connection to the Onay app failed: ${String(error)}`)
        }
      })
    })
    port.onDisconnect.addListener(() => {
      // Read the reason now: the browser clears it after this call.
      const reason = this.#options.lastError()
      this.#inbox = this.#inbox.then(() => {
        if (this.#attempt !== attempt) return
        if (reason === NOT_INSTALLED) {
          this.#fail(attempt, 'not-installed', 'The Onay app is not installed.')
        } else {
          this.#fail(attempt, 'not-running', 'The Onay app closed the connection.')
        }
      })
    })
    this.#inbox = this.#inbox.then(async () => {
      if (this.#attempt !== attempt) return
      try {
        await this.#sendHello(attempt)
      } catch (error) {
        this.#fail(attempt, 'refused', `The extension cannot start the connection: ${String(error)}`)
      }
    })
  }

  // Sends a message to the app. Returns false if the link is not ready;
  // the caller keeps the message for later.
  send(message: ClientMessage): boolean {
    const attempt = this.#attempt
    if (this.#status.state !== 'ready' || !attempt?.sealer) return false
    attempt.sealer.seal(encoder.encode(JSON.stringify(message))).then(
      (sealed) => {
        if (this.#attempt === attempt) attempt.port.postMessage({ type: 'sealed', data: toBase64(sealed) })
      },
      (error) => this.#fail(attempt, 'refused', `The extension cannot seal a message: ${String(error)}`),
    )
    return true
  }

  async #sendHello(attempt: Attempt): Promise<void> {
    const identity = await this.#options.store.identity()
    attempt.extension = { publicKey: await publicKeyBytes(identity.publicKey), salt: randomSalt() }
    attempt.port.postMessage({
      type: 'hello',
      version: VERSION,
      publicKey: toBase64(attempt.extension.publicKey),
      salt: toBase64(attempt.extension.salt),
    })
  }

  async #receive(attempt: Attempt, frame: unknown): Promise<void> {
    if (!isServerFrame(frame)) throw new Error('unknown message')
    switch (frame.type) {
      case 'error': {
        const reason = frame.message === NOT_RUNNING ? 'not-running' : 'refused'
        const message = reason === 'not-running' ? 'The Onay app is not running.' : frame.message
        this.#fail(attempt, reason, message)
        return
      }
      case 'hello':
        await this.#receiveHello(attempt, frame)
        return
      case 'sealed': {
        if (!attempt.opener) throw new Error('a sealed message came before the hello')
        const plaintext = await attempt.opener.open(fromBase64(frame.data))
        await this.#receiveMessage(attempt, JSON.parse(decoder.decode(plaintext)) as ServerMessage)
      }
    }
  }

  async #receiveHello(attempt: Attempt, frame: Extract<ServerFrame, { type: 'hello' }>): Promise<void> {
    if (!attempt.extension || attempt.opener) throw new Error('a hello came at the wrong time')
    if (frame.version !== VERSION) throw new Error('the app has a different version')
    const app: Hello = { publicKey: fromBase64(frame.publicKey), salt: fromBase64(frame.salt) }
    const identity = await this.#options.store.identity()
    const { sealer, opener } = await session(identity.privateKey, 'extension', attempt.extension, app)
    attempt.appKey = app.publicKey
    attempt.sealer = sealer
    attempt.opener = opener

    if (!frame.paired) {
      const code = await pairingCode(attempt.extension.publicKey, app.publicKey)
      this.#setStatus({ state: 'pairing', code })
      return
    }
    // The app says it knows this extension. It must be the app that this
    // extension knows too.
    const known = await this.#options.store.appKey()
    if (!known || !sameBytes(known, app.publicKey)) {
      this.#fail(attempt, 'refused', 'The Onay app is not the app this extension paired with.')
      return
    }
    this.#setStatus({ state: 'ready' })
  }

  async #receiveMessage(attempt: Attempt, message: ServerMessage): Promise<void> {
    if (this.#status.state !== 'pairing' || !attempt.appKey) throw new Error('unexpected message')
    switch (message.type) {
      case 'paired':
        await this.#options.store.setAppKey(attempt.appKey)
        this.#setStatus({ state: 'ready' })
        return
      case 'pairing-rejected':
        this.#fail(attempt, 'refused', 'The pairing was rejected in the Onay app.')
        return
      default:
        throw new Error('unknown message')
    }
  }

  // Ends the attempt. The first reason stays: the relay reports "not
  // running" first and then closes the port.
  #fail(attempt: Attempt, reason: 'not-installed' | 'not-running' | 'refused', message: string): void {
    if (this.#attempt !== attempt) return
    this.#attempt = null
    attempt.port.disconnect()
    this.#setStatus({ state: 'unavailable', reason, message })
  }

  #setStatus(status: LinkStatus): void {
    this.#status = status
    this.#options.onStatus(status)
  }
}
