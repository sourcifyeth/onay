import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Pending } from '../src/pending.ts'

const request = (origin: string, at: number) => ({ origin, method: 'eth_sendTransaction', at })

test('a request is pending until the wallet answers', () => {
  const pending = new Pending()
  pending.add('a', request('https://a.example', 1000))
  pending.add('b', request('https://b.example', 2000))
  assert.equal(pending.count(2000), 2)
  assert.equal(pending.latest(2000)?.origin, 'https://b.example')
  assert.equal(pending.settle('b')?.origin, 'https://b.example')
  assert.equal(pending.settle('b'), undefined)
  assert.equal(pending.count(2000), 1)
  assert.equal(pending.latest(2000)?.origin, 'https://a.example')
})

test('the window shows each request once', () => {
  const pending = new Pending()
  assert.equal(pending.unshown(0), false)
  pending.add('a', request('https://a.example', 1000))
  assert.equal(pending.unshown(1000), true)
  pending.markShown()
  assert.equal(pending.unshown(1000), false)
  pending.add('b', request('https://b.example', 1500))
  assert.equal(pending.unshown(1500), true)
})

test('an old request goes away by itself', () => {
  const pending = new Pending()
  pending.add('a', request('https://a.example', 0))
  assert.equal(pending.count(10 * 60 * 1000), 1)
  assert.equal(pending.count(10 * 60 * 1000 + 1), 0)
  assert.equal(pending.settle('a'), undefined)
})
