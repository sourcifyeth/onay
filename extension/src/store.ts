// What the extension keeps between runs: its own key pair and the public
// key of the app it paired with. IndexedDB can hold a key that scripts
// cannot export, so the private key never appears as bytes.

import { generateIdentity } from './channel.ts'
import type { Bytes } from './channel.ts'

export interface Store {
  identity(): Promise<CryptoKeyPair>
  appKey(): Promise<Bytes | null>
  setAppKey(key: Bytes): Promise<void>
}

const DATABASE = 'onay'
const KEYS = 'keys'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(KEYS)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function run<T>(mode: IDBTransactionMode, action: (keys: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await open()
  try {
    return await new Promise((resolve, reject) => {
      const request = action(database.transaction(KEYS, mode).objectStore(KEYS))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

export function openStore(): Store {
  let identity: Promise<CryptoKeyPair> | null = null
  return {
    identity() {
      // One promise for all callers, so two callers cannot make two keys.
      identity ??= (async () => {
        const stored = await run<CryptoKeyPair | undefined>('readonly', (keys) => keys.get('identity'))
        if (stored) return stored
        const fresh = await generateIdentity()
        await run('readwrite', (keys) => keys.put(fresh, 'identity'))
        return fresh
      })()
      return identity
    },
    async appKey() {
      return (await run<Bytes | undefined>('readonly', (keys) => keys.get('appKey'))) ?? null
    },
    async setAppKey(key) {
      await run('readwrite', (keys) => keys.put(key, 'appKey'))
    },
  }
}
