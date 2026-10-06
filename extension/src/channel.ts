// The encrypted channel between the extension and the app, version 1.
// The specification is at the top of app/src-tauri/src/channel.rs. Both
// implementations must match testdata/channel-v1.json.

export const VERSION = 1
const KEY_LEN = 32
const SALT_LEN = 32
const LABEL_EXT_TO_APP = 'onay v1 ext->app'
const LABEL_APP_TO_EXT = 'onay v1 app->ext'
const LABEL_PAIRING = 'onay v1 pairing'

export type Bytes = Uint8Array<ArrayBuffer>
export type Role = 'extension' | 'app'
// The public half of one side's hello message.
export type Hello = { publicKey: Bytes; salt: Bytes }

const encoder = new TextEncoder()

function concat(...parts: Uint8Array[]): Bytes {
  const all = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    all.set(part, offset)
    offset += part.length
  }
  return all
}

export function toBase64(bytes: Uint8Array): string {
  let text = ''
  // In pieces: a long argument list overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(text)
}

export function fromBase64(text: string): Bytes {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
}

// A long-term key. The private key cannot leave the browser's key store.
export function generateIdentity(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']) as Promise<CryptoKeyPair>
}

export async function publicKeyBytes(key: CryptoKey): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key))
}

export function randomSalt(): Bytes {
  return crypto.getRandomValues(new Uint8Array(SALT_LEN))
}

// Derives the two directions of a session.
export async function session(
  privateKey: CryptoKey,
  role: Role,
  extension: Hello,
  app: Hello,
): Promise<{ sealer: Sealer; opener: Opener }> {
  const theirs = role === 'extension' ? app.publicKey : extension.publicKey
  if (theirs.length !== KEY_LEN || extension.salt.length !== SALT_LEN || app.salt.length !== SALT_LEN) {
    throw new Error('the hello has a wrong length')
  }
  const theirKey = await crypto.subtle.importKey('raw', theirs, { name: 'X25519' }, false, [])
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'X25519', public: theirKey }, privateKey, 8 * KEY_LEN),
  )
  // Anyone can compute an all-zero secret.
  if (shared.every((byte) => byte === 0)) throw new Error('the public key is not acceptable')

  const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits'])
  const salt = concat(extension.salt, app.salt)
  const key = async (label: string, usage: KeyUsage) => {
    const info = concat(encoder.encode(label), extension.publicKey, app.publicKey)
    const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, material, 8 * KEY_LEN)
    return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, [usage])
  }
  const [sealLabel, openLabel] =
    role === 'extension' ? [LABEL_EXT_TO_APP, LABEL_APP_TO_EXT] : [LABEL_APP_TO_EXT, LABEL_EXT_TO_APP]
  return {
    sealer: new Sealer(await key(sealLabel, 'encrypt')),
    opener: new Opener(await key(openLabel, 'decrypt')),
  }
}

// The code that both sides show during pairing. Equal codes mean that
// both sides see the same two public keys.
export async function pairingCode(extensionKey: Uint8Array, appKey: Uint8Array): Promise<string> {
  const input = concat(encoder.encode(LABEL_PAIRING), extensionKey, appKey)
  const digest = new DataView(await crypto.subtle.digest('SHA-256', input))
  const digits = String(digest.getUint32(0) % 1_000_000).padStart(6, '0')
  return `${digits.slice(0, 3)} ${digits.slice(3)}`
}

function nonce(counter: number): Bytes {
  const bytes = new Uint8Array(12)
  new DataView(bytes.buffer).setBigUint64(4, BigInt(counter))
  return bytes
}

// Encrypts the messages of one direction. Calls can overlap: the messages
// are sealed in the order of the calls.
export class Sealer {
  #key: CryptoKey
  #counter = 0
  #last: Promise<unknown> = Promise.resolve()

  constructor(key: CryptoKey) {
    this.#key = key
  }

  seal(plaintext: Bytes): Promise<Bytes> {
    const sealed = this.#last.then(async () => {
      const iv = nonce(this.#counter)
      const result = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.#key, plaintext)
      this.#counter += 1
      return new Uint8Array(result)
    })
    this.#last = sealed.catch(() => {})
    return sealed
  }
}

// Decrypts the messages of one direction, in the order they were sealed.
// A message that is lost, repeated, reordered, or changed fails to open.
export class Opener {
  #key: CryptoKey
  #counter = 0
  #last: Promise<unknown> = Promise.resolve()

  constructor(key: CryptoKey) {
    this.#key = key
  }

  open(sealed: Bytes): Promise<Bytes> {
    const opened = this.#last.then(async () => {
      const iv = nonce(this.#counter)
      const result = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.#key, sealed)
      this.#counter += 1
      return new Uint8Array(result)
    })
    this.#last = opened.catch(() => {})
    return opened
  }
}
