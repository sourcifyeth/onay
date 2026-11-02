import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Fetch } from '../src/gates/gate.ts'
import { CHECK_EVERY, createUpdateStore, noticeOf, RETRY_AFTER, statusOf, type UpdateDeps } from '../src/updateStore.ts'

const releases = (...tags: string[]) => tags.map((tag_name) => ({ tag_name, draft: false, prerelease: false }))

// A fake network that answers from a list the test changes, and counts the requests.
function fakes(version = '0.1.0') {
  const net = { answer: releases('0.2.0') as unknown, fail: false, requests: 0 }
  let clock = 1_000_000
  const fetch: Fetch = async () => {
    net.requests += 1
    if (net.fail) throw new Error('offline')
    return Response.json(net.answer)
  }
  const deps: UpdateDeps = { getVersion: async () => version, fetch, now: () => clock }
  return { net, deps, advance: (ms: number) => (clock += ms) }
}

test('a check reads the version and the latest release, and the notice shows a newer one', async () => {
  const { deps } = fakes()
  const store = createUpdateStore(deps)
  assert.equal(statusOf(store.getSnapshot()), null)
  await store.checkNow()
  const state = store.getSnapshot()
  assert.equal(state.current, '0.1.0')
  assert.equal(state.latest, '0.2.0')
  assert.equal(state.checkedAt, 1_000_000)
  assert.equal(statusOf(state), 'newer')
  assert.equal(noticeOf(state), '0.2.0')
})

test('dismiss hides the notice until a still newer version comes out', async () => {
  const { net, deps } = fakes()
  const store = createUpdateStore(deps)
  await store.checkNow()
  store.dismiss('0.2.0')
  assert.equal(noticeOf(store.getSnapshot()), null)
  assert.equal(statusOf(store.getSnapshot()), 'newer')
  net.answer = releases('0.3.0', '0.2.0')
  await store.checkNow()
  assert.equal(noticeOf(store.getSnapshot()), '0.3.0')
})

test('no notice for the latest release or a build above it', async () => {
  const { net, deps } = fakes('0.2.0')
  const store = createUpdateStore(deps)
  await store.checkNow()
  assert.equal(statusOf(store.getSnapshot()), 'latest')
  assert.equal(noticeOf(store.getSnapshot()), null)
  net.answer = releases('0.1.0')
  await store.checkNow()
  assert.equal(statusOf(store.getSnapshot()), 'ahead')
  assert.equal(noticeOf(store.getSnapshot()), null)
})

test('a failed check keeps the last good answer and records the error', async () => {
  const { net, deps } = fakes()
  const store = createUpdateStore(deps)
  await store.checkNow()
  net.fail = true
  await store.checkNow()
  const state = store.getSnapshot()
  assert.equal(state.latest, '0.2.0')
  assert.equal(state.error, 'offline')
  assert.equal(noticeOf(state), '0.2.0')
  net.fail = false
  await store.checkNow()
  assert.equal(store.getSnapshot().error, null)
})

test('a failed version read is an error too', async () => {
  const { deps } = fakes()
  const store = createUpdateStore({ ...deps, getVersion: () => Promise.reject(new Error('no app')) })
  await store.checkNow()
  assert.equal(store.getSnapshot().error, 'no app')
  assert.equal(statusOf(store.getSnapshot()), null)
})

test('one check at a time', async () => {
  const { net, deps } = fakes()
  const store = createUpdateStore(deps)
  await Promise.all([store.checkNow(), store.checkNow(), store.tick()])
  assert.equal(net.requests, 1)
  assert.equal(store.getSnapshot().checking, false)
})

test('tick checks once a day after a good check, and soon after a failed one', async () => {
  const { net, deps, advance } = fakes()
  const store = createUpdateStore(deps)
  await store.tick()
  assert.equal(net.requests, 1)
  advance(CHECK_EVERY - 1)
  await store.tick()
  assert.equal(net.requests, 1)
  // After a sleep, the next tick sees the time that passed.
  advance(1)
  net.fail = true
  await store.tick()
  assert.equal(net.requests, 2)
  advance(RETRY_AFTER - 1)
  await store.tick()
  assert.equal(net.requests, 2)
  advance(1)
  net.fail = false
  await store.tick()
  assert.equal(net.requests, 3)
  assert.equal(store.getSnapshot().error, null)
})

test('subscribers hear each change', async () => {
  const { deps } = fakes()
  const store = createUpdateStore(deps)
  let calls = 0
  const stop = store.subscribe(() => (calls += 1))
  await store.checkNow()
  assert.ok(calls > 0)
  stop()
  const before = calls
  store.dismiss('0.2.0')
  assert.equal(calls, before)
})
