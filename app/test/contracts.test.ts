import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Hex } from '../src/messages.ts'
import { add, initial, MAX_CONTRACTS, passedCount, pending, withChain, type Contract } from '../src/gates/contracts.ts'

const A: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const B: Hex = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function address(n: number): Hex {
  return `0x${n.toString(16).padStart(40, '0')}`
}

const code = (contract: Contract) => ({ address: contract.address, block: 1, code: '0x60' as Hex })

test('initial: one waiting contract for each address, in the order of the request', () => {
  assert.deepEqual(initial([A, B]), [
    { address: A, chain: { status: 'waiting' } },
    { address: B, chain: { status: 'waiting' } },
  ])
  assert.deepEqual(initial([]), [])
})

test('add: a new address goes at the end, in lower case', () => {
  const contracts = add([], A.toUpperCase().replace('0X', '0x') as Hex)
  assert.deepEqual(contracts, [{ address: A, chain: { status: 'waiting' } }])
})

test('add: an address that is in the list gives the same list, whatever its case', () => {
  const contracts = initial([A])!
  assert.equal(add(contracts, A), contracts)
  assert.equal(add(contracts, A.toUpperCase().replace('0X', '0x') as Hex), contracts)
})

test('add: a full list gives null, and so does a request with too many contracts', () => {
  const addresses = Array.from({ length: MAX_CONTRACTS }, (_, n) => address(n + 1))
  const full = initial(addresses)!
  assert.equal(full.length, MAX_CONTRACTS)
  assert.equal(add(full, A), null)
  assert.equal(add(full, addresses[0]), full)
  assert.equal(initial([...addresses, A]), null)
})

test('withChain changes the state of one contract and keeps the others', () => {
  const contracts = initial([A, B])!
  const changed = withChain(contracts, B, { status: 'running' })
  assert.deepEqual(changed, [
    { address: A, chain: { status: 'waiting' } },
    { address: B, chain: { status: 'running' } },
  ])
  assert.deepEqual(contracts[1].chain, { status: 'waiting' })
})

test('pending while a contract waits or runs, not when each one passed or failed', () => {
  let contracts = initial([A, B])!
  assert.equal(pending(contracts), true)
  contracts = withChain(contracts, A, { status: 'passed', value: code(contracts[0]) })
  assert.equal(pending(contracts), true)
  contracts = withChain(contracts, B, { status: 'running' })
  assert.equal(pending(contracts), true)
  contracts = withChain(contracts, B, { status: 'failed', reason: 'no proof' })
  assert.equal(pending(contracts), false)
  assert.equal(passedCount(contracts), 1)
  assert.equal(pending([]), false)
})

test('a contract added during the run makes the list pending again', () => {
  let contracts = initial([A])!
  contracts = withChain(contracts, A, { status: 'passed', value: code(contracts[0]) })
  assert.equal(pending(contracts), false)
  contracts = add(contracts, B)!
  assert.equal(pending(contracts), true)
  assert.equal(passedCount(contracts), 1)
})
