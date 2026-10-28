// The state that the simulation runs on. The EVM asks for accounts, code
// and storage slots as it runs; each one is read from the chain at the
// block of the request, through the same call as the gates, and kept. In
// Helios mode each read comes with a proof. The writes of the EVM stay in
// the cache, with the checkpoints that a reverted call undoes. Modeled on
// the RPCStateManager of @ethereumjs/statemanager, which takes a URL
// only. This module has no browser or Tauri calls, so the tests run it
// as it is.

import type { AccountFields, StateManagerInterface } from '@ethereumjs/common'
import { Caches, OriginalStorageCache } from '@ethereumjs/statemanager'
import {
  Account,
  createAccount,
  createAccountFromRLP,
  equalsBytes,
  hexToBytes,
  setLengthLeft,
  unpadBytes,
  type Address,
} from '@ethereumjs/util'
import type { Hex } from '../messages.ts'
import type { ChainRead } from './helios.ts'

// How many times the chain was asked.
export type Reads = { accounts: number; slots: number }

const EMPTY_CODE_HASH = hexToBytes('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')

// A load-balanced endpoint can answer a read at the head block from a
// node that has not seen the head yet. The read is tried again after a
// pause, this many times.
const LAG_RETRIES = 3
const LAG_PAUSE = 1000
const LAG = /header not found|unknown block|block not found/i

export type Sleep = (ms: number) => Promise<void>

const sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export class ChainStateManager implements StateManagerInterface {
  originalStorageCache: OriginalStorageCache
  readonly reads: Reads = { accounts: 0, slots: 0 }
  // The code of each address as the chain gave it, before any write of
  // the EVM. '0x' for an address without code.
  readonly codes = new Map<Hex, Hex>()

  private caches = new Caches({ storage: { size: 100_000 }, code: { size: 100_000 } })
  private read: ChainRead
  private block: Hex
  private sleep: Sleep

  constructor(read: ChainRead, block: number, pause: Sleep = sleep) {
    this.read = read
    this.block = `0x${block.toString(16)}`
    this.sleep = pause
    this.originalStorageCache = new OriginalStorageCache(this.getStorage.bind(this))
  }

  // A read at the block of the request, tried again while the node lags.
  private async readAtBlock(method: string, params: unknown[]): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.read(method, [...params, this.block])
      } catch (error) {
        if (attempt === LAG_RETRIES || !LAG.test(error instanceof Error ? error.message : String(error))) throw error
        await this.sleep(LAG_PAUSE)
      }
    }
  }

  async getAccount(address: Address): Promise<Account | undefined> {
    const cached = this.caches.account?.get(address)
    if (cached !== undefined) {
      return cached.accountRLP !== undefined ? createAccountFromRLP(cached.accountRLP) : undefined
    }
    this.reads.accounts++
    const proof = asRecord(await this.readAtBlock('eth_getProof', [address.toString(), []]), 'eth_getProof')
    const account = createAccount({
      nonce: asQuantity(proof.nonce, 'eth_getProof'),
      balance: asQuantity(proof.balance, 'eth_getProof'),
      codeHash: hexToBytes(asHash(proof.codeHash, 'eth_getProof')),
      storageRoot: hexToBytes(asHash(proof.storageHash, 'eth_getProof')),
    })
    // An address that the chain does not know has no account.
    const empty = account.nonce === 0n && account.balance === 0n && equalsBytes(account.codeHash, EMPTY_CODE_HASH)
    const known = empty ? undefined : account
    this.caches.account?.put(address, known)
    return known
  }

  async putAccount(address: Address, account?: Account): Promise<void> {
    if (account !== undefined) this.caches.account?.put(address, account)
    else this.caches.account?.del(address)
  }

  async deleteAccount(address: Address): Promise<void> {
    this.caches.deleteAccount(address)
  }

  async modifyAccountFields(address: Address, fields: AccountFields): Promise<void> {
    const account = (await this.getAccount(address)) ?? new Account()
    account.nonce = fields.nonce ?? account.nonce
    account.balance = fields.balance ?? account.balance
    account.storageRoot = fields.storageRoot ?? account.storageRoot
    account.codeHash = fields.codeHash ?? account.codeHash
    await this.putAccount(address, account)
  }

  async getCode(address: Address): Promise<Uint8Array> {
    const cached = this.caches.code?.get(address)?.code
    if (cached !== undefined) return cached
    const code = asHex(await this.readAtBlock('eth_getCode', [address.toString()]), 'eth_getCode')
    this.codes.set(address.toString() as Hex, code)
    const bytes = hexToBytes(code)
    this.caches.code?.put(address, bytes)
    return bytes
  }

  async getCodeSize(address: Address): Promise<number> {
    return (await this.getCode(address)).length
  }

  async putCode(address: Address, value: Uint8Array): Promise<void> {
    this.caches.code?.put(address, value)
  }

  async getStorage(address: Address, key: Uint8Array): Promise<Uint8Array> {
    if (key.length !== 32) throw new Error('a storage key must be 32 bytes')
    const cached = this.caches.storage?.get(address, key)
    if (cached !== undefined) return cached
    this.reads.slots++
    const slot = `0x${Array.from(key, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
    const value = asHex(await this.readAtBlock('eth_getStorageAt', [address.toString(), slot]), 'eth_getStorageAt')
    // The EVM keeps values without leading zeros: a zero is empty.
    const bytes = unpadBytes(setLengthLeft(hexToBytes(value), 32))
    this.caches.storage?.put(address, key, bytes)
    return bytes
  }

  async putStorage(address: Address, key: Uint8Array, value: Uint8Array): Promise<void> {
    this.caches.storage?.put(address, key, value)
  }

  async clearStorage(address: Address): Promise<void> {
    this.caches.storage?.clearStorage(address)
  }

  async checkpoint(): Promise<void> {
    this.caches.checkpoint()
  }

  async commit(): Promise<void> {
    this.caches.commit()
  }

  async revert(): Promise<void> {
    this.caches.revert()
  }

  // The EVM reads state through the methods above. It never asks for a
  // state root, and this manager has none.
  async getStateRoot(): Promise<Uint8Array> {
    return new Uint8Array(32)
  }

  async setStateRoot(): Promise<void> {}

  async hasStateRoot(): Promise<boolean> {
    return false
  }

  clearCaches(): void {
    this.caches.clear()
  }

  shallowCopy(): StateManagerInterface {
    return new ChainStateManager(this.read, Number(this.block), this.sleep)
  }
}

function unexpected(method: string): Error {
  return new Error(`${method} gave an unexpected answer`)
}

function asRecord(value: unknown, method: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw unexpected(method)
  return value as Record<string, unknown>
}

function asHex(value: unknown, method: string): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]*$/.test(value)) throw unexpected(method)
  return value as Hex
}

function asHash(value: unknown, method: string): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw unexpected(method)
  return value as Hex
}

function asQuantity(value: unknown, method: string): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) throw unexpected(method)
  return BigInt(value)
}
