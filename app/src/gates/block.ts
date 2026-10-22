// The block that the simulation runs in: the header of
// eth_getBlockByNumber, checked field by field, and the rules of the
// hardfork. This module has no browser or Tauri calls.

import { createCustomCommon, Hardfork, Mainnet } from '@ethereumjs/common'
import { createAddressFromString, hexToBytes } from '@ethereumjs/util'
import type { Hex } from '../messages.ts'

export type Header = {
  number: number
  timestamp: number
  gasLimit: bigint
  baseFee: bigint | null
  coinbase: Hex
  prevRandao: Hex
  excessBlobGas: bigint | null
}

// The rules of the newest Ethereum hardfork. A chain that lags behind
// runs the same contracts the same way, apart from the newest opcodes.
export function commonFor(chainId: number) {
  return createCustomCommon({ chainId }, Mainnet, { hardfork: Hardfork.Osaka, params: PARAMS })
}

// The two entries of `paramsBlock` in @ethereumjs/block that the blob
// fee needs, keyed by EIP. The common applies the blob forks on top.
const PARAMS = {
  4844: { blobGasPriceUpdateFraction: 3338477 },
  7691: { blobGasPriceUpdateFraction: 5007716 },
}

// The header of eth_getBlockByNumber. In RPC mode nothing else checks the
// fields, so each one the EVM reads is checked here.
export function parseHeader(value: unknown): Header {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw unexpected('a block')
  const block = value as Record<string, unknown>
  const number = Number(quantity(block.number, 'number'))
  const timestamp = Number(quantity(block.timestamp, 'timestamp'))
  if (!Number.isSafeInteger(number) || !Number.isSafeInteger(timestamp)) throw unexpected('a block number')
  return {
    number,
    timestamp,
    gasLimit: quantity(block.gasLimit, 'gas limit'),
    baseFee: block.baseFeePerGas == null ? null : quantity(block.baseFeePerGas, 'base fee'),
    coinbase: hex(block.miner, 40, 'miner'),
    prevRandao: block.mixHash == null ? `0x${'0'.repeat(64)}` : hex(block.mixHash, 64, 'mixHash'),
    excessBlobGas: block.excessBlobGas == null ? null : quantity(block.excessBlobGas, 'excess blob gas'),
  }
}

// The block as the EVM reads it.
export function blockFor(header: Header, blobFraction: bigint) {
  return {
    header: {
      number: BigInt(header.number),
      coinbase: createAddressFromString(header.coinbase),
      timestamp: BigInt(header.timestamp),
      difficulty: 0n,
      prevRandao: hexToBytes(header.prevRandao),
      gasLimit: header.gasLimit,
      baseFeePerGas: header.baseFee ?? undefined,
      getBlobGasPrice: () => blobGasPrice(header.excessBlobGas ?? 0n, blobFraction),
    },
  }
}

// EIP-4844, with the update fraction of the hardfork.
export function blobGasPrice(excessBlobGas: bigint, fraction: bigint): bigint {
  let i = 1n
  let output = 0n
  let accumulated = fraction
  while (accumulated > 0n) {
    output += accumulated
    accumulated = (accumulated * excessBlobGas) / (fraction * i)
    i++
  }
  return output / fraction
}

function unexpected(what: string): Error {
  return new Error(`eth_getBlockByNumber gave an unexpected ${what}`)
}

function quantity(value: unknown, what: string): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) throw unexpected(what)
  return BigInt(value)
}

function hex(value: unknown, digits: number, what: string): Hex {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-fA-F]{${digits}}$`).test(value)) throw unexpected(what)
  return value.toLowerCase() as Hex
}
