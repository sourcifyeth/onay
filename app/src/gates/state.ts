// The state that the simulation runs on. The EVM asks for accounts, code
// and storage slots as it runs; each one is read from the chain at the
// block of the request, through the same call as the gates, and kept. In
// Helios mode each read comes with a proof. The writes of the EVM stay in
// the cache, with the checkpoints that a reverted call undoes. The values
// of the chain stay apart from the writes: `diff` compares the two, and
// `before` gives the state without the writes. Modeled on the
// RPCStateManager of @ethereumjs/statemanager, which takes a URL only.
// This module has no browser or Tauri calls, so the tests run it as it is.

import type { AccountFields, StateManagerInterface } from '@ethereumjs/common'
import { Caches, OriginalStorageCache } from '@ethereumjs/statemanager'
import {
  Account,
  createAccount,
  createAccountFromRLP,
  bytesToHex,
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

// One account whose balance or nonce the run changed.
export type AccountChange = {
  address: Hex
  balance: { before: bigint; after: bigint }
  nonce: { before: bigint; after: bigint }
}

// One storage slot whose value the run changed. The slot and the values
// are 32 bytes each.
export type SlotChange = { address: Hex; slot: Hex; before: Hex; after: Hex }

// What the run changed, in the order of the first write.
export type StateDiff = { accounts: AccountChange[]; slots: SlotChange[] }

type AccountData = { nonce: bigint; balance: bigint; codeHash: Uint8Array; storageRoot: Uint8Array }

// What the chain gave, read once and never changed. A state and its
// `before` state share it.
type Origin = {
  read: ChainRead
  block: Hex
  reads: Reads
  codes: Map<Hex, Hex>
  // Null for an address that the chain does not know.
  accounts: Map<Hex, AccountData | null>
  // By address and slot. The values have no leading zeros.
  slots: Map<string, Uint8Array>
}

const EMPTY_CODE_HASH = hexToBytes('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')

export class ChainStateManager implements StateManagerInterface {
  originalStorageCache: OriginalStorageCache
  readonly reads: Reads
  // The code of each address as the chain gave it, before any write of
  // the EVM. '0x' for an address without code.
  readonly codes: Map<Hex, Hex>

  private caches = new Caches({ storage: { size: 100_000 }, code: { size: 100_000 } })
  private origin: Origin
  // The accounts and the slots that the EVM wrote to, in the order of
  // the first write. A write that a revert undid stays in here: `diff`
  // drops it, because its value did not change.
  private wroteAccounts = new Map<Hex, Address>()
  private wroteSlots = new Map<string, { address: Address; key: Uint8Array }>()

  constructor(read: ChainRead, block: number, origin?: Origin) {
    this.origin = origin ?? {
      read,
      block: `0x${block.toString(16)}`,
      reads: { accounts: 0, slots: 0 },
      codes: new Map(),
      accounts: new Map(),
      slots: new Map(),
    }
    this.reads = this.origin.reads
    this.codes = this.origin.codes
    this.originalStorageCache = new OriginalStorageCache(this.getStorage.bind(this))
  }

  // The state of the chain without the writes of this one. It reads the
  // chain only for a value that this state did not read.
  before(): ChainStateManager {
    return new ChainStateManager(this.origin.read, Number(this.origin.block), this.origin)
  }

  // Each balance, nonce and storage slot that now differs from the value
  // of the chain.
  async diff(): Promise<StateDiff> {
    const accounts: AccountChange[] = []
    for (const [hex, address] of this.wroteAccounts) {
      const before = await this.chainAccount(address)
      const after = await this.getAccount(address)
      const balance = { before: before?.balance ?? 0n, after: after?.balance ?? 0n }
      const nonce = { before: before?.nonce ?? 0n, after: after?.nonce ?? 0n }
      if (balance.before !== balance.after || nonce.before !== nonce.after) {
        accounts.push({ address: hex, balance, nonce })
      }
    }
    const slots: SlotChange[] = []
    for (const { address, key } of this.wroteSlots.values()) {
      const before = await this.chainSlot(address, key)
      const after = await this.getStorage(address, key)
      if (!equalsBytes(before, after)) {
        slots.push({
          address: address.toString() as Hex,
          slot: bytesToHex(key) as Hex,
          before: word(before),
          after: word(after),
        })
      }
    }
    return { accounts, slots }
  }

  async getAccount(address: Address): Promise<Account | undefined> {
    const cached = this.caches.account?.get(address)
    if (cached !== undefined) {
      return cached.accountRLP !== undefined ? createAccountFromRLP(cached.accountRLP) : undefined
    }
    const data = await this.chainAccount(address)
    const known = data === null ? undefined : createAccount(data)
    this.caches.account?.put(address, known)
    return known
  }

  private async chainAccount(address: Address): Promise<AccountData | null> {
    const hex = address.toString() as Hex
    const kept = this.origin.accounts.get(hex)
    if (kept !== undefined) return kept
    this.origin.reads.accounts++
    const { read, block } = this.origin
    const proof = asRecord(await read('eth_getProof', [hex, [], block]), 'eth_getProof')
    const data: AccountData = {
      nonce: asQuantity(proof.nonce, 'eth_getProof'),
      balance: asQuantity(proof.balance, 'eth_getProof'),
      codeHash: hexToBytes(asHash(proof.codeHash, 'eth_getProof')),
      storageRoot: hexToBytes(asHash(proof.storageHash, 'eth_getProof')),
    }
    // An address that the chain does not know has no account.
    const empty = data.nonce === 0n && data.balance === 0n && equalsBytes(data.codeHash, EMPTY_CODE_HASH)
    const known = empty ? null : data
    this.origin.accounts.set(hex, known)
    return known
  }

  async putAccount(address: Address, account?: Account): Promise<void> {
    this.wroteAccounts.set(address.toString() as Hex, address)
    if (account !== undefined) this.caches.account?.put(address, account)
    else this.caches.account?.del(address)
  }

  async deleteAccount(address: Address): Promise<void> {
    this.wroteAccounts.set(address.toString() as Hex, address)
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
    const hex = address.toString() as Hex
    let code = this.origin.codes.get(hex)
    if (code === undefined) {
      code = asHex(await this.origin.read('eth_getCode', [hex, this.origin.block]), 'eth_getCode')
      this.origin.codes.set(hex, code)
    }
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
    const bytes = await this.chainSlot(address, key)
    this.caches.storage?.put(address, key, bytes)
    return bytes
  }

  private async chainSlot(address: Address, key: Uint8Array): Promise<Uint8Array> {
    const slot = bytesToHex(key)
    const id = `${address.toString()}:${slot}`
    const kept = this.origin.slots.get(id)
    if (kept !== undefined) return kept
    this.origin.reads.slots++
    const { read, block } = this.origin
    const value = asHex(await read('eth_getStorageAt', [address.toString(), slot, block]), 'eth_getStorageAt')
    // The EVM keeps values without leading zeros: a zero is empty.
    const bytes = unpadBytes(setLengthLeft(hexToBytes(value), 32))
    this.origin.slots.set(id, bytes)
    return bytes
  }

  async putStorage(address: Address, key: Uint8Array, value: Uint8Array): Promise<void> {
    this.wroteSlots.set(`${address.toString()}:${bytesToHex(key)}`, { address, key })
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
    return this.before()
  }
}

// A value as the 32 bytes of its slot.
function word(value: Uint8Array): Hex {
  return bytesToHex(setLengthLeft(value, 32)) as Hex
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
