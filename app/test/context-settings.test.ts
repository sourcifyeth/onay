import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  contextSettingsStore,
  DEFAULT_CONTEXT_SETTINGS,
  isEtherscanKey,
  loadContextSettings,
  parseContextSettings,
  saveContextSettings,
  STORAGE_KEY,
} from '../src/context/settings.ts'

const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678'

// A storage in memory, as the webview has one.
function memoryStorage() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  }
}

test('a fresh install has no key, and GoPlus and the prices on', () => {
  assert.deepEqual(loadContextSettings(null), { etherscanKey: '', goPlus: true, prices: true })
  assert.deepEqual(DEFAULT_CONTEXT_SETTINGS, { etherscanKey: '', goPlus: true, prices: true })
})

test('the settings survive a reload', () => {
  const storage = memoryStorage()
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  try {
    let calls = 0
    const stop = contextSettingsStore.subscribe(() => calls++)
    saveContextSettings({ etherscanKey: KEY, goPlus: false, prices: false })
    stop()
    assert.equal(calls, 1)
    assert.deepEqual(contextSettingsStore.getSnapshot(), { etherscanKey: KEY, goPlus: false, prices: false })
    assert.deepEqual(loadContextSettings(storage.getItem(STORAGE_KEY)), {
      etherscanKey: KEY,
      goPlus: false,
      prices: false,
    })
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
})

test('saving works when the storage throws: the change stays in memory', () => {
  // Node 22 has no localStorage, so the write throws.
  saveContextSettings({ etherscanKey: ' KEY2 ', goPlus: true, prices: true })
  assert.deepEqual(contextSettingsStore.getSnapshot(), { etherscanKey: 'KEY2', goPlus: true, prices: true })
})

test('a bad value in storage is dropped, the rest stays', () => {
  assert.deepEqual(loadContextSettings('not json'), DEFAULT_CONTEXT_SETTINGS)
  assert.deepEqual(loadContextSettings('[1,2]'), DEFAULT_CONTEXT_SETTINGS)
  assert.deepEqual(loadContextSettings('"text"'), DEFAULT_CONTEXT_SETTINGS)
  assert.deepEqual(parseContextSettings({ etherscanKey: 'a b&c=d', goPlus: false, prices: false }), {
    etherscanKey: '',
    goPlus: false,
    prices: false,
  })
  assert.deepEqual(parseContextSettings({ etherscanKey: 42, goPlus: 'yes', prices: 1 }), DEFAULT_CONTEXT_SETTINGS)
  assert.deepEqual(parseContextSettings({ etherscanKey: ` ${KEY} ` }), {
    etherscanKey: KEY,
    goPlus: true,
    prices: true,
  })
})

test('isEtherscanKey keeps other text out of the URL', () => {
  assert.ok(isEtherscanKey(KEY))
  assert.ok(isEtherscanKey(''))
  assert.ok(!isEtherscanKey('abc&apikey=x'))
  assert.ok(!isEtherscanKey('abc def'))
  assert.ok(!isEtherscanKey('A'.repeat(65)))
})
