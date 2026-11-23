import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chargedGas, floorGas, gasPriceOf, intrinsicGas } from '../src/gates/gas.ts'

test('intrinsic gas: 21,000, then 4 for a zero byte and 16 for any other byte', () => {
  assert.equal(intrinsicGas('0x'), 21_000n)
  assert.equal(intrinsicGas('0x00'), 21_004n)
  assert.equal(intrinsicGas('0xa9059cbb'), 21_064n)
  assert.equal(intrinsicGas('0x00ff00'), 21_024n)
})

test('the floor of EIP-7623: 10 gas for each token, four tokens for a byte that is not zero', () => {
  assert.equal(floorGas('0x'), 21_000n)
  assert.equal(floorGas('0x00'), 21_010n)
  assert.equal(floorGas('0xff'), 21_040n)
})

test('the charged gas: the refund is at most a fifth, and the floor is the least', () => {
  // A plain transfer: no code, no refund.
  assert.equal(chargedGas('0x', 0n, 0n), 21_000n)
  // 21,064 + 30,000 = 51,064. The refund of 20,000 is capped at 10,212.
  assert.equal(chargedGas('0xa9059cbb', 30_000n, 20_000n), 40_852n)
  assert.equal(chargedGas('0xa9059cbb', 30_000n, 5_000n), 46_064n)
  // Large calldata and little execution: the floor applies.
  const data = `0x${'ff'.repeat(1000)}` as const
  assert.equal(chargedGas(data, 100n, 0n), floorGas(data))
})

test('the gas price: from the request, else the base fee of the block with no tip', () => {
  assert.deepEqual(gasPriceOf(undefined, 10n), { price: 10n, fromRequest: false })
  assert.deepEqual(gasPriceOf(undefined, null), { price: 0n, fromRequest: false })
  assert.deepEqual(gasPriceOf({ gasPrice: 30n }, 10n), { price: 30n, fromRequest: true })
  assert.deepEqual(gasPriceOf({ maxFeePerGas: 100n, maxPriorityFeePerGas: 2n }, 10n), {
    price: 12n,
    fromRequest: true,
  })
  // The base fee plus the tip is above the most that the sender pays.
  assert.deepEqual(gasPriceOf({ maxFeePerGas: 11n, maxPriorityFeePerGas: 2n }, 10n), {
    price: 11n,
    fromRequest: true,
  })
  assert.deepEqual(gasPriceOf({ maxFeePerGas: 50n }, 10n), { price: 10n, fromRequest: true })
})
