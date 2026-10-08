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
// hash, is not.
export type CreationRead =
  | { creation: Creation; reason?: undefined; retry?: undefined }
  | { creation: null; reason: string; retry: boolean }

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
  if (tx === null || receipt === null) throw new Error('the chain does not know the transaction')
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
