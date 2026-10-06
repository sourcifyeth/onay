// Runs the built page script (dist/inpage.js) inside a fake page.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

import type { PageMessage } from '../src/messages.ts'

const source = readFileSync(new URL('../dist/inpage.js', import.meta.url), 'utf8')

type Listener = (event: { type: string; detail?: unknown }) => void

function page(ethereum?: object) {
  const posted: PageMessage[] = []
  const listeners = new Map<string, Listener[]>()
  const addEventListener = (type: string, listener: Listener) => {
    listeners.set(type, [...(listeners.get(type) ?? []), listener])
  }
  const fire = (type: string, detail?: unknown) => {
    for (const listener of listeners.get(type) ?? []) listener({ type, detail })
  }
  const window: Record<string, unknown> = {
    location: { origin: 'https://dapp.example' },
    postMessage: (message: PageMessage, targetOrigin: string) => {
      assert.equal(targetOrigin, 'https://dapp.example')
      posted.push(structuredClone(message))
    },
    addEventListener,
    dispatchEvent: (event: { type: string }) => (fire(event.type), true),
    ethereum,
  }
  class Event {
    type: string
    constructor(type: string) {
      this.type = type
    }
  }
  vm.runInNewContext(source, { window, document: { addEventListener }, Event })
  return { window, posted, fire }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

// A wallet provider that records its calls.
function wallet(answer: () => Promise<unknown> = async () => '0xsigned') {
  const calls: { self: unknown; args: unknown[] }[] = []
  const provider = {
    calls,
    request(this: unknown, ...args: unknown[]) {
      calls.push({ self: this, args })
      return answer()
    },
  }
  return provider
}

test('a signing request is reported, and the wallet gets the same call', async () => {
  const provider = wallet()
  const { posted } = page(provider)
  const args = { method: 'personal_sign', params: ['0x68656c6c6f', '0xabc'] }

  const result = await provider.request(args)
  assert.equal(result, '0xsigned')
  assert.equal(provider.calls.length, 1)
  assert.equal(provider.calls[0].self, provider)
  assert.equal(provider.calls[0].args[0], args, 'the same object, not a copy')

  await tick()
  assert.deepEqual(posted, [
    { onay: 'request', id: '1', method: 'personal_sign', params: ['0x68656c6c6f', '0xabc'] },
    { onay: 'settled', id: '1', outcome: 'fulfilled' },
  ])
})

test('the report comes before the wallet is called', () => {
  let reportedFirst = false
  const state = page({
    request() {
      reportedFirst = state.posted.length === 1
      return Promise.resolve()
    },
  })
  ;(state.window.ethereum as { request: (args: unknown) => unknown }).request({ method: 'eth_sendTransaction', params: [{}] })
  assert.ok(reportedFirst)
})

test('a rejection by the wallet reaches the page and is reported', async () => {
  const refusal = Object.assign(new Error('User rejected the request.'), { code: 4001 })
  const provider = wallet(() => Promise.reject(refusal))
  const { posted } = page(provider)

  await assert.rejects(provider.request({ method: 'eth_sendTransaction', params: [{ to: '0x1' }] }) as Promise<unknown>, refusal)
  await tick()
  assert.deepEqual(posted.at(-1), { onay: 'settled', id: '1', outcome: 'rejected' })
})

test('every signing method is reported, other methods are not', async () => {
  const provider = wallet()
  const { posted } = page(provider)
  const signing = [
    'eth_sendTransaction',
    'eth_signTransaction',
    'wallet_sendCalls',
    'eth_signTypedData',
    'eth_signTypedData_v3',
    'eth_signTypedData_v4',
    'personal_sign',
    'eth_sign',
  ]
  for (const method of [...signing, 'eth_chainId', 'eth_call', 'eth_requestAccounts', 'wallet_switchEthereumChain']) {
    await provider.request({ method, params: [] })
  }
  await tick()
  const reported = posted.filter((message) => message.onay === 'request').map((message) => message.method)
  assert.deepEqual(reported, signing)
  assert.equal(provider.calls.length, signing.length + 4)
})

test('odd calls go to the wallet unchanged and report nothing', async () => {
  const provider = wallet()
  const { posted } = page(provider)
  for (const args of [[], [null], ['personal_sign'], [{ method: 42 }], [{}]]) {
    await provider.request(...args)
  }
  assert.equal(provider.calls.length, 5)
  assert.deepEqual(posted, [])
})

test('parameters that are not plain data do not stop the call', async () => {
  const provider = wallet()
  const { posted } = page(provider)
  await provider.request({ method: 'eth_sendTransaction', params: [{ value: 10n }] })
  assert.equal(provider.calls.length, 1)
  assert.deepEqual(posted[0], { onay: 'request', id: '1', method: 'eth_sendTransaction', params: null })
})

test('a provider announced with EIP-6963 is watched', async () => {
  const provider = wallet()
  const { posted, fire } = page()
  fire('eip6963:announceProvider', { info: { name: 'Wallet' }, provider })
  // A second announcement must not wrap the provider twice.
  fire('eip6963:announceProvider', { info: { name: 'Wallet' }, provider })
  await provider.request({ method: 'personal_sign', params: [] })
  assert.equal(posted.filter((message) => message.onay === 'request').length, 1)
  assert.equal(provider.calls.length, 1)
})

test('a provider that appears later on window.ethereum is watched', async () => {
  const provider = wallet()
  const { window, posted, fire } = page()
  window.ethereum = provider
  fire('ethereum#initialized')
  await provider.request({ method: 'personal_sign', params: [] })
  assert.equal(posted.length >= 1, true)
})

test('the script asks ready wallets to announce themselves', () => {
  const types: string[] = []
  vm.runInNewContext(source, {
    window: {
      location: { origin: 'https://dapp.example' },
      postMessage() {},
      addEventListener() {},
      dispatchEvent: (event: { type: string }) => (types.push(event.type), true),
    },
    document: { addEventListener() {} },
    Event: class {
      type: string
      constructor(type: string) {
        this.type = type
      }
    },
  })
  assert.deepEqual(types, ['eip6963:requestProvider'])
})

test('sendAsync with a callback', async () => {
  const seen: unknown[][] = []
  const provider = {
    sendAsync(payload: unknown, callback: (error: unknown, response: unknown) => void) {
      callback(null, { id: 7, jsonrpc: '2.0', error: { code: 4001, message: 'no' } })
      return payload
    },
  }
  const { posted } = page(provider)
  const payload = { id: 7, jsonrpc: '2.0', method: 'eth_sendTransaction', params: [{ to: '0x1' }] }
  provider.sendAsync(payload, (...args) => seen.push(args))

  assert.equal(seen.length, 1)
  assert.equal(seen[0][0], null)
  assert.deepEqual(posted, [
    { onay: 'request', id: '1', method: 'eth_sendTransaction', params: [{ to: '0x1' }] },
    { onay: 'settled', id: '1', outcome: 'rejected' },
  ])
})

test('a batch reports each signing request in it', async () => {
  const provider = {
    sendAsync(_payload: unknown, callback: (error: unknown, response: unknown) => void) {
      callback(null, [{ result: '0x1' }, { result: '0x2' }, { result: '0x3' }])
    },
  }
  const { posted } = page(provider)
  provider.sendAsync(
    [
      { method: 'personal_sign', params: ['a'] },
      { method: 'eth_chainId', params: [] },
      { method: 'eth_sign', params: ['b'] },
    ],
    () => {},
  )
  assert.deepEqual(posted.map((message) => [message.onay, message.id]), [
    ['request', '1'],
    ['request', '2'],
    ['settled', '1'],
    ['settled', '2'],
  ])
})

test('send in its three forms', async () => {
  const provider = {
    send(first: unknown, second?: unknown) {
      if (typeof second === 'function') return second(new Error('failed'), undefined)
      return Promise.resolve(first)
    },
  }
  const { posted } = page(provider)

  await provider.send('personal_sign', ['a'])
  await tick()
  provider.send({ method: 'eth_sign', params: ['b'] }, () => {})
  await provider.send({ method: 'eth_sendTransaction', params: ['c'] })
  await tick()
  assert.deepEqual(posted.map((message) => (message.onay === 'request' ? message.method : message.outcome)), [
    'personal_sign',
    'fulfilled',
    'eth_sign',
    'rejected',
    'eth_sendTransaction',
    'fulfilled',
  ])
})

test('a frozen provider keeps working and is not watched', async () => {
  const provider = Object.freeze(wallet())
  const { posted } = page(provider)
  assert.equal(await provider.request({ method: 'personal_sign', params: [] }), '0xsigned')
  assert.deepEqual(posted, [])
})
