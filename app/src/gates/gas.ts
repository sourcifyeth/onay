// The gas of a transaction as the chain charges it, from the gas of the
// run. The EVM of the simulation runs a call, not a transaction, so it
// does not charge the intrinsic gas, the floor of the calldata
// (EIP-7623) or the refund cap. This module has no EVM in it.

import type { Hex } from '../messages.ts'
import type { Fees } from './request.ts'

const TX_BASE = 21_000n
// EIP-7825: the most gas that one transaction can use.
export const TX_GAS_CAP = 1n << 24n

// The zero and the other bytes of the calldata.
function bytesOf(data: Hex): { zero: bigint; other: bigint } {
  let zero = 0n
  let other = 0n
  for (let i = 2; i < data.length; i += 2) {
    if (data.slice(i, i + 2) === '00') zero++
    else other++
  }
  return { zero, other }
}

// The gas that a call costs before any code runs.
export function intrinsicGas(data: Hex): bigint {
  const { zero, other } = bytesOf(data)
  return TX_BASE + 4n * zero + 16n * other
}

// EIP-7623: a transaction pays at least 10 gas for each token of its
// calldata. A zero byte is one token, any other byte is four.
export function floorGas(data: Hex): bigint {
  const { zero, other } = bytesOf(data)
  return TX_BASE + 10n * (zero + 4n * other)
}

// The gas that the chain charges for a call whose code used `execution`
// gas and earned `refund`. The refund is at most a fifth of the gas.
export function chargedGas(data: Hex, execution: bigint, refund: bigint): bigint {
  const gross = intrinsicGas(data) + execution
  const cap = gross / 5n
  const net = gross - (refund < cap ? refund : cap)
  const floor = floorGas(data)
  return net > floor ? net : floor
}

// The price of one unit of gas. The request sets it, or the wallet does.
// Without a price in the request, it is the base fee of the block with
// no tip: a wallet adds a tip, so the fee is a low estimate.
export type GasPrice = { price: bigint; fromRequest: boolean }

export function gasPriceOf(fees: Fees | undefined, baseFee: bigint | null): GasPrice {
  const base = baseFee ?? 0n
  if (fees?.maxFeePerGas !== undefined) {
    const tip = fees.maxPriorityFeePerGas ?? 0n
    const price = base + tip
    return { price: price < fees.maxFeePerGas ? price : fees.maxFeePerGas, fromRequest: true }
  }
  if (fees?.gasPrice !== undefined) return { price: fees.gasPrice, fromRequest: true }
  return { price: base, fromRequest: false }
}
