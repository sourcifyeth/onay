// The creation transaction of a contract, as the chain gate read it. Only
// a transaction that deployed the contract directly gives its creation
// bytecode: the input of the transaction. A contract that another contract
// created needs traces, and a light client cannot verify traces. This
// module has no browser or Tauri calls, so the tests run it as it is.

import type { Hex } from '../messages.ts'
import { parseQuantity } from './request.ts'

export type Creation = {
  transactionHash: Hex
  blockNumber: number
  transactionIndex: number
  deployer: Hex
  // The creation bytecode, with the constructor arguments after it.
  input: Hex
  // True if a light client checked the block, the transaction and the
  // receipt. False if an endpoint gave them without proof.
  verified: boolean
}

// The creation transaction, or why it was not read. A read that failed
// on the way, for example on a rate limit, is tried again on the next
// request. A factory deployment, or a chain that does not know the
// hash, is not. `block` is the block of a transaction that the chain
// gave but that did not deploy the contract directly, as for a factory.
export type CreationRead =
  | { creation: Creation; reason?: undefined; retry?: undefined; block?: undefined }
  | { creation: null; reason: string; retry: boolean; block?: number }

export type CreationReader = (address: Hex, transactionHash: Hex) => Promise<CreationRead>

// The answers to eth_getTransactionByHash and eth_getTransactionReceipt.
// Each field that the app reads is checked: in RPC mode nothing else
// checks them.
export function parseCreation(
  address: Hex,
  transactionHash: Hex,
  tx: unknown,
  receipt: unknown,
  verified: boolean,
): Creation {
  if (tx === null || receipt === null) throw new Error(UNKNOWN_TRANSACTION)
  const transaction = asRecord(tx, 'transaction')
  const record = asRecord(receipt, 'receipt')
  const created = record.contractAddress
  if (typeof created !== 'string' || created.toLowerCase() !== address.toLowerCase()) {
    throw new Error('created by another contract · the creation bytecode is in an internal call, which cannot be read')
  }
  const blockNumber = parseQuantity(transaction.blockNumber)
  const transactionIndex = parseQuantity(record.transactionIndex)
  if (blockNumber === null || transactionIndex === null) throw unexpected('transaction')
  return {
    transactionHash,
    blockNumber,
    transactionIndex,
    deployer: asHex(transaction.from, 'transaction'),
    input: asHex(transaction.input, 'transaction'),
    verified,
  }
}

// The block of a transaction answer. Null when it does not read.
export function transactionBlock(tx: unknown): number | null {
  if (typeof tx !== 'object' || tx === null) return null
  return parseQuantity((tx as { blockNumber?: unknown }).blockNumber)
}

// Helios says "block N is outside EIP-2935 ring buffer range (latest: M,
// buffer size: 8191)" for a block it cannot verify. Null for any other
// error.
export function oldBlock(message: string): string | null {
  const old = /block (\d+) is outside EIP-2935 ring buffer range \(latest: (\d+), buffer size: (\d+)\)/.exec(message)
  if (!old) return null
  const [, block, latest, size] = old
  const age = Number(latest) - Number(block)
  return `${age.toLocaleString('en-US')} blocks old · Helios can verify the newest ${Number(size).toLocaleString('en-US')} only`
}

export const UNKNOWN_TRANSACTION = 'the chain does not know the transaction'

// Helios answers a hash that the chain does not know with this error,
// not with null.
export function unknownTransaction(message: string): boolean {
  return /receipt not found/.test(message)
}

function unexpected(what: string): Error {
  return new Error(`the chain answered with an unexpected ${what}`)
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw unexpected(what)
  return value as Record<string, unknown>
}

function asHex(value: unknown, what: string): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]*$/.test(value)) throw unexpected(what)
  return value as Hex
}
