import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Inbox } from '../src/inbox.ts'

test('an ID is accepted once per document', () => {
  const inbox = new Inbox()
  assert.equal(inbox.accept('doc-a', '1'), true)
  assert.equal(inbox.accept('doc-a', '1'), false)
  assert.equal(inbox.accept('doc-a', '2'), true)
  // The same ID in another document is another request.
  assert.equal(inbox.accept('doc-b', '1'), true)
})

test('an outcome is known only for a forwarded request', () => {
  const inbox = new Inbox()
  assert.equal(inbox.known('doc-a', '1'), false)
  inbox.accept('doc-a', '1')
  assert.equal(inbox.known('doc-a', '1'), true)
  assert.equal(inbox.known('doc-b', '1'), false)
})

test('a forgotten document starts over', () => {
  const inbox = new Inbox()
  inbox.accept('doc-a', '1')
  inbox.forget('doc-a')
  inbox.forget('doc-never')
  assert.equal(inbox.known('doc-a', '1'), false)
  assert.equal(inbox.accept('doc-a', '1'), true)
})

test('the oldest documents go when the limit is reached', () => {
  const inbox = new Inbox(4)
  inbox.accept('old', '1')
  inbox.accept('old', '2')
  inbox.accept('new', '1')
  inbox.accept('new', '2')
  assert.equal(inbox.known('old', '1'), true)
  // One more than the limit: the oldest document is dropped as a whole.
  inbox.accept('newest', '1')
  assert.equal(inbox.known('old', '1'), false)
  assert.equal(inbox.known('old', '2'), false)
  assert.equal(inbox.known('new', '1'), true)
  assert.equal(inbox.known('newest', '1'), true)
  // One document alone is never dropped as a whole: its oldest ID goes.
  const one = new Inbox(2)
  for (const id of ['1', '2', '3']) one.accept('only', id)
  assert.equal(one.known('only', '1'), false)
  assert.equal(one.known('only', '3'), true)
  assert.equal(one.accept('only', '1'), true)
})
