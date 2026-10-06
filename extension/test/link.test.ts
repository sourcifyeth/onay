import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fromBase64, generateIdentity, pairingCode, publicKeyBytes, randomSalt, session, toBase64 } from '../src/channel.ts'
import type { Bytes, Opener, Sealer } from '../src/channel.ts'
import { Link } from '../src/link.ts'
import type { NativePort } from '../src/link.ts'
import type { ClientFrame, ClientMessage, LinkStatus, ServerFrame, ServerMessage } from '../src/messages.ts'
import type { Store } from '../src/store.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// A stand-in for chrome.runtime.Port.
class FakePort implements NativePort {
  sent: ClientFrame[] = []
  disconnected = false
  #onMessage: ((message: unknown) => void)[] = []
  #onDisconnect: (() => void)[] = []
  onMessage = { addListener: (listener: (message: unknown) => void) => void this.#onMessage.push(listener) }
  onDisconnect = { addListener: (listener: () => void) => void this.#onDisconnect.push(listener) }

  postMessage(message: ClientFrame) {
    this.sent.push(message)
  }
  disconnect() {
    this.disconnected = true
  }
  // The other side sends a frame.
  receive(frame: unknown) {
    for (const listener of this.#onMessage) listener(frame)
  }
  // The other side closes the port.
  close() {
    for (const listener of this.#onDisconnect) listener()
  }
}

function memoryStore(appKey: Bytes | null = null): Store & { savedAppKey: () => Bytes | null } {
  const identity = generateIdentity()
  return {
    identity: () => identity,
    appKey: async () => appKey,
    setAppKey: async (key) => void (appKey = key),
    savedAppKey: () => appKey,
  }
}

async function until(done: () => boolean) {
  for (let i = 0; i < 2000 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 1))
  assert.ok(done(), 'the expected state was not reached')
}

// A stand-in for the app. It answers the hello of the link.
class FakeApp {
  keys!: CryptoKeyPair
  publicKey!: Bytes
  sealer!: Sealer
  opener!: Opener
  code = ''

  static async create(): Promise<FakeApp> {
    const app = new FakeApp()
    app.keys = await generateIdentity()
    app.publicKey = await publicKeyBytes(app.keys.publicKey)
    return app
  }

  async answerHello(port: FakePort, paired: boolean) {
    await until(() => port.sent.length > 0)
    const hello = port.sent[0]
    assert.equal(hello.type, 'hello')
    if (hello.type !== 'hello') return
    assert.equal(hello.version, 1)
    const extension = { publicKey: fromBase64(hello.publicKey), salt: fromBase64(hello.salt) }
    const mine = { publicKey: this.publicKey, salt: randomSalt() }
    const { sealer, opener } = await session(this.keys.privateKey, 'app', extension, mine)
    this.sealer = sealer
    this.opener = opener
    this.code = await pairingCode(extension.publicKey, this.publicKey)
    const frame: ServerFrame = {
      type: 'hello',
      version: 1,
      publicKey: toBase64(mine.publicKey),
      salt: toBase64(mine.salt),
      paired,
    }
    port.receive(frame)
  }

  async send(port: FakePort, message: ServerMessage) {
    const sealed = await this.sealer.seal(encoder.encode(JSON.stringify(message)))
    port.receive({ type: 'sealed', data: toBase64(sealed) } satisfies ServerFrame)
  }

  async open(frame: ClientFrame): Promise<ClientMessage> {
    assert.equal(frame.type, 'sealed')
    if (frame.type !== 'sealed') throw new Error('not sealed')
    return JSON.parse(decoder.decode(await this.opener.open(fromBase64(frame.data))))
  }
}

function setup(store = memoryStore(), lastError: () => string | undefined = () => undefined) {
  const ports: FakePort[] = []
  const statuses: LinkStatus[] = []
  const link = new Link({
    connect: () => {
      const port = new FakePort()
      ports.push(port)
      return port
    },
    lastError,
    store,
    onStatus: (status) => statuses.push(status),
  })
  return { link, ports, statuses, store }
}

const request = (id: string): ClientMessage => ({
  type: 'request',
  id,
  origin: 'https://example.org',
  method: 'personal_sign',
  params: ['0x68656c6c6f'],
})

test('first connection: pairing, then sealed requests in order', async () => {
  const { link, ports, store } = setup()
  const app = await FakeApp.create()

  assert.equal(link.send(request('early')), false)
  link.start()
  link.start()
  assert.equal(ports.length, 1, 'a second start does not connect again')
  await app.answerHello(ports[0], false)
  await until(() => link.status.state === 'pairing')
  assert.deepEqual(link.status, { state: 'pairing', code: app.code })
  assert.equal(link.send(request('during-pairing')), false)
  assert.equal(store.savedAppKey(), null)

  await app.send(ports[0], { type: 'paired' })
  await until(() => link.status.state === 'ready')
  assert.deepEqual(store.savedAppKey(), app.publicKey)

  for (const id of ['a', 'b', 'c']) assert.equal(link.send(request(id)), true)
  await until(() => ports[0].sent.length === 4)
  for (const [i, id] of ['a', 'b', 'c'].entries()) {
    assert.deepEqual(await app.open(ports[0].sent[i + 1]), request(id))
  }
})

test('known app: ready without pairing', async () => {
  const app = await FakeApp.create()
  const { link, ports, statuses } = setup(memoryStore(app.publicKey))
  link.start()
  await app.answerHello(ports[0], true)
  await until(() => link.status.state === 'ready')
  assert.deepEqual(statuses.map((status) => status.state), ['connecting', 'ready'])
})

test('an app that claims a pairing with another key is refused', async () => {
  const known = await FakeApp.create()
  const other = await FakeApp.create()
  const { link, ports } = setup(memoryStore(known.publicKey))
  link.start()
  await other.answerHello(ports[0], true)
  await until(() => link.status.state === 'unavailable')
  assert.equal(link.status.state === 'unavailable' && link.status.reason, 'refused')
  assert.ok(ports[0].disconnected)
})

test('rejected pairing', async () => {
  const { link, ports, store } = setup()
  const app = await FakeApp.create()
  link.start()
  await app.answerHello(ports[0], false)
  await until(() => link.status.state === 'pairing')
  await app.send(ports[0], { type: 'pairing-rejected' })
  await until(() => link.status.state === 'unavailable')
  assert.equal(store.savedAppKey(), null)
})

test('the relay reports that the app is not running, and a new start connects again', async () => {
  const { link, ports } = setup()
  link.start()
  ports[0].receive({ type: 'error', message: 'app not running' })
  ports[0].close()
  await until(() => link.status.state === 'unavailable')
  assert.deepEqual(link.status, { state: 'unavailable', reason: 'not-running', message: 'The Onay app is not running.' })

  link.start()
  assert.equal(ports.length, 2)
})

test('the app refuses the browser', async () => {
  const { link, ports } = setup()
  link.start()
  ports[0].receive({ type: 'error', message: 'The Onay app refused the connection: not a browser.' })
  await until(() => link.status.state === 'unavailable')
  assert.deepEqual(link.status, {
    state: 'unavailable',
    reason: 'refused',
    message: 'The Onay app refused the connection: not a browser.',
  })
})

test('no host manifest: not installed', async () => {
  const { link, ports } = setup(memoryStore(), () => 'Specified native messaging host not found.')
  link.start()
  ports[0].close()
  await until(() => link.status.state === 'unavailable')
  assert.equal(link.status.state === 'unavailable' && link.status.reason, 'not-installed')
})

test('the app closes the connection later', async () => {
  const app = await FakeApp.create()
  const { link, ports } = setup(memoryStore(app.publicKey))
  link.start()
  await app.answerHello(ports[0], true)
  await until(() => link.status.state === 'ready')
  ports[0].close()
  await until(() => link.status.state === 'unavailable')
  assert.equal(link.status.state === 'unavailable' && link.status.reason, 'not-running')
  assert.equal(link.send(request('late')), false)
})

test('a frame that is not part of the protocol ends the connection', async () => {
  for (const frame of [null, 'text', { type: 'unknown' }, { type: 'sealed', data: 'AAAA' }]) {
    const { link, ports } = setup()
    link.start()
    ports[0].receive(frame)
    await until(() => link.status.state === 'unavailable')
    assert.equal(link.status.state === 'unavailable' && link.status.reason, 'refused')
    assert.ok(ports[0].disconnected)
  }
})

test('a message that does not open ends the connection', async () => {
  const app = await FakeApp.create()
  const { link, ports } = setup(memoryStore(app.publicKey))
  link.start()
  await app.answerHello(ports[0], true)
  await until(() => link.status.state === 'ready')
  ports[0].receive({ type: 'sealed', data: toBase64(new Uint8Array(40)) })
  await until(() => link.status.state === 'unavailable')
})
