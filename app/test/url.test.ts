import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hostOf } from '../src/url.ts'

test('a URL gives its host, with the port', () => {
  assert.equal(hostOf('https://sepolia.gateway.tenderly.co/path?q=1'), 'sepolia.gateway.tenderly.co')
  assert.equal(hostOf('http://localhost:8545'), 'localhost:8545')
})

test('a value that is not a URL comes back cut to 60 characters, without a throw', () => {
  assert.equal(hostOf('not a url'), 'not a url')
  assert.equal(hostOf('x'.repeat(100)), 'x'.repeat(60))
})
