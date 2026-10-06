import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { fromBase64, generateIdentity, pairingCode, publicKeyBytes, randomSalt, session, toBase64 } from '../src/channel.ts'
import type { Bytes, Hello } from '../src/channel.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function side(): Promise<{ keys: CryptoKeyPair; hello: Hello }> {
  const keys = await generateIdentity()
  return { keys, hello: { publicKey: await publicKeyBytes(keys.publicKey), salt: randomSalt() } }
}

async function pair() {
  const extension = await side()
  const app = await side()
  return {
    extension: await session(extension.keys.privateKey, 'extension', extension.hello, app.hello),
    app: await session(app.keys.privateKey, 'app', extension.hello, app.hello),
  }
}

test('both directions round trip', async () => {
  const { extension, app } = await pair()
  for (const text of ['first', '', 'third']) {
    const up = await extension.sealer.seal(encoder.encode(text))
    assert.equal(decoder.decode(await app.opener.open(up)), text)
    const down = await app.sealer.seal(encoder.encode(text))
    assert.equal(decoder.decode(await extension.opener.open(down)), text)
  }
})

test('repeated, reordered, and changed messages fail', async () => {
  const { extension, app } = await pair()
  const first = await extension.sealer.seal(encoder.encode('first'))
  const second = await extension.sealer.seal(encoder.encode('second'))

  await assert.rejects(app.opener.open(second), 'out of order')
  assert.equal(decoder.decode(await app.opener.open(first)), 'first')
  await assert.rejects(app.opener.open(first), 'repeated')
  const changed = second.slice()
  changed[0] ^= 1
  await assert.rejects(app.opener.open(changed), 'changed')
  // A failure does not move the counter.
  assert.equal(decoder.decode(await app.opener.open(second)), 'second')
})

test('overlapping seal calls keep their order', async () => {
  const { extension, app } = await pair()
  const sealed = await Promise.all(['a', 'b', 'c'].map((text) => extension.sealer.seal(encoder.encode(text))))
  for (const [i, text] of ['a', 'b', 'c'].entries()) {
    assert.equal(decoder.decode(await app.opener.open(sealed[i])), text)
  }
})

test('another identity cannot open', async () => {
  const { extension } = await pair()
  const other = await pair()
  const sealed = await extension.sealer.seal(encoder.encode('hello'))
  await assert.rejects(other.app.opener.open(sealed))
})

test('a weak public key is rejected', async () => {
  const mine = await side()
  const weak: Hello = { publicKey: new Uint8Array(32), salt: randomSalt() }
  await assert.rejects(session(mine.keys.privateKey, 'app', weak, mine.hello))
})

test('base64 round trip, also for long input', () => {
  const bytes = new Uint8Array(100_000).map((_, i) => i % 251)
  assert.deepEqual(fromBase64(toBase64(bytes)), bytes)
})

// The same vectors are checked by app/src-tauri/src/channel.rs.
test('matches the shared test vectors', async () => {
  const vectors = JSON.parse(readFileSync(new URL('../../testdata/channel-v1.json', import.meta.url), 'utf8'))
  const bytes = (name: string): Bytes => fromBase64(vectors[name])
  // PKCS #8 wrapping of a raw X25519 private key.
  const pkcs8 = (secret: Bytes) =>
    new Uint8Array([...fromBase64('MC4CAQAwBQYDK2VuBCIEIA=='), ...secret])
  const importSecret = (name: string) =>
    crypto.subtle.importKey('pkcs8', pkcs8(bytes(name)), { name: 'X25519' }, false, ['deriveBits'])

  const extensionHello: Hello = { publicKey: bytes('extensionPublic'), salt: bytes('extensionSalt') }
  const appHello: Hello = { publicKey: bytes('appPublic'), salt: bytes('appSalt') }
  assert.equal(await pairingCode(extensionHello.publicKey, appHello.publicKey), vectors.pairingCode)

  const extension = await session(await importSecret('extensionSecret'), 'extension', extensionHello, appHello)
  const app = await session(await importSecret('appSecret'), 'app', extensionHello, appHello)
  for (const message of vectors.messages) {
    const [from, to] = message.from === 'extension' ? [extension, app] : [app, extension]
    const sealed = await from.sealer.seal(encoder.encode(message.plaintext))
    assert.equal(toBase64(sealed), message.sealed)
    assert.equal(decoder.decode(await to.opener.open(fromBase64(message.sealed))), message.plaintext)
  }
})
