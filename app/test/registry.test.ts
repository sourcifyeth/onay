import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EMPTY_INDEX, registryIndex } from '../src/clear-signing/registry.ts'

test('registryIndex gives up after the deadline, and the next call fetches again', async () => {
  // The deadline timer does not keep the loop alive on its own.
  const alive = setInterval(() => {}, 10)
  let calls = 0
  const stalled = () => {
    calls += 1
    return new Promise<typeof EMPTY_INDEX>(() => {})
  }
  await assert.rejects(registryIndex(stalled, 20), /longer than 0.02 s/)
  const quick = async () => {
    calls += 1
    return EMPTY_INDEX
  }
  assert.equal(await registryIndex(quick, 20), EMPTY_INDEX)
  assert.equal(calls, 2)
  // The good index serves the session.
  assert.equal(await registryIndex(stalled, 20), EMPTY_INDEX)
  assert.equal(calls, 2)
  clearInterval(alive)
})
