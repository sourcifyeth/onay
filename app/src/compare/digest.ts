// The ERC-8213 digests: the values that a wallet which implements the
// standard shows before it signs, with the names that the standard
// gives them. This module has no browser or Tauri calls, so the tests
// run it as it is.
// https://github.com/ethereum/ERCs/pull/1639 (draft)

import type { TypedData } from '@ethereum-sourcify/clear-signing'
import { TypedDataEncoder, concat, getBytes, hashMessage, keccak256, toBeHex } from 'ethers'
import type { Hex } from '../messages.ts'

// keccak256(uint256(len(calldata)) || calldata)
export function calldataDigest(data: Hex): Hex {
  const bytes = getBytes(data)
  return keccak256(concat([toBeHex(bytes.length, 32), bytes])) as Hex
}

// keccak256("\x19Ethereum Signed Message:\n" || len(message) || message),
// with the length in decimal.
export function erc191Digest(message: Uint8Array): Hex {
  return hashMessage(message) as Hex
}

export type TypedDataDigests = {
  // keccak256("\x19\x01" || Domain Hash || Message Hash)
  digest: Hex
  domainHash: Hex
  messageHash: Hex
}

type Types = TypedData['types']

// Thrown when the typed data does not hash one way in every wallet.
class Unreadable extends Error {}

// The digests of the typed data, or why there are none. Wallets read
// loose data in different ways: MetaMask takes a string for a bool or a
// missing field, and ethers refuses each. So the data must be in the one
// form that all of them read alike. Otherwise the digest here could
// differ from the one the wallet signs. A bad address checksum is no
// such case: the case of the letters is no part of the signed bytes.
export function typedDataDigests(
  typed: TypedData,
  version: 'v3' | 'v4',
): { digests: TypedDataDigests; reason?: undefined } | { digests: null; reason: string } {
  const { types, primaryType } = typed
  // MetaMask hashes a missing domain type as an empty one. Libraries
  // such as ethers and viem take the fields of the domain instead.
  if (!Object.hasOwn(types, 'EIP712Domain')) {
    return {
      digests: null,
      reason: 'the typed data has no EIP712Domain type, and wallets hash such a domain differently',
    }
  }
  if (primaryType === 'EIP712Domain' || !Object.hasOwn(types, primaryType)) {
    return { digests: null, reason: `the typed data has no type for its primary type ${primaryType}` }
  }
  try {
    const domainHash = structHash(types, 'EIP712Domain', typed.domain, 'domain', version)
    const messageHash = structHash(types, primaryType, typed.message, 'message', version)
    const digest = keccak256(concat(['0x1901', domainHash, messageHash])) as Hex
    return { digests: { digest, domainHash, messageHash } }
  } catch (error) {
    const text = error instanceof Unreadable ? error.message : errorText(error)
    return { digests: null, reason: text }
  }
}

function errorText(error: unknown): string {
  const short = (error as { shortMessage?: unknown } | null)?.shortMessage
  if (typeof short === 'string') return short
  return error instanceof Error ? error.message : String(error)
}

// The hash of a struct, as EIP-712 defines it. ethers takes only types
// that the struct uses, so the others are left out here.
function structHash(types: Types, name: string, value: unknown, path: string, version: 'v3' | 'v4'): Hex {
  const used = dependencies(types, name)
  for (const type of used) {
    for (const member of types[type]) {
      const base = member.type.replace(/(\[[0-9]*\])+$/, '')
      if (!isAtomic(base) && !Object.hasOwn(types, base)) {
        throw new Unreadable(`${type}.${member.name} has the type ${member.type}, which EIP-712 does not define`)
      }
    }
  }
  const subset = Object.fromEntries([...used].map((type) => [type, types[type]]))
  const normalized = normalize(types, name, value, path, version) as Record<string, unknown>
  return TypedDataEncoder.from(subset).hashStruct(name, normalized) as Hex
}

// The struct and every type it references.
function dependencies(types: Types, name: string, found = new Set<string>()): Set<string> {
  if (found.has(name) || !Object.hasOwn(types, name)) return found
  found.add(name)
  for (const member of types[name]) dependencies(types, member.type.replace(/(\[[0-9]*\])+$/, ''), found)
  return found
}

// Bare uint and int are not EIP-712 types: ethers reads them as uint256
// and int256, MetaMask hashes the name as it is.
function isAtomic(type: string): boolean {
  if (type === 'address' || type === 'bool' || type === 'string' || type === 'bytes') return true
  const fixed = /^bytes([1-9][0-9]?)$/.exec(type)
  if (fixed) return Number(fixed[1]) <= 32
  const int = /^u?int([1-9][0-9]*)$/.exec(type)
  if (int) return Number(int[1]) % 8 === 0 && Number(int[1]) <= 256
  return false
}

// The value as every wallet reads it, or Unreadable. Addresses come back
// in lower case: the case is no part of the signed bytes.
function normalize(types: Types, type: string, value: unknown, path: string, version: 'v3' | 'v4'): unknown {
  const array = /^(.+)\[([0-9]*)\]$/.exec(type)
  if (array) {
    if (version === 'v3') throw new Unreadable(`${path} is an array, and only eth_signTypedData_v4 encodes arrays`)
    if (!Array.isArray(value)) throw new Unreadable(`${path} is not an array`)
    if (array[2] !== '' && value.length !== Number(array[2])) {
      throw new Unreadable(`${path} has ${value.length} items, its type ${type} has ${array[2]}`)
    }
    return value.map((item, index) => normalize(types, array[1], item, `${path}[${index}]`, version))
  }
  if (Object.hasOwn(types, type)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Unreadable(`${path} is not an object`)
    }
    const record = value as Record<string, unknown>
    const entries = types[type].map(({ name, type: member }) => {
      // EIP-712 v3 leaves out a missing field, v4 hashes a missing
      // struct as zero, and ethers refuses both.
      if (!Object.hasOwn(record, name) || record[name] === undefined || record[name] === null) {
        throw new Unreadable(`${path}.${name} has no value`)
      }
      return [name, normalize(types, member, record[name], `${path}.${name}`, version)]
    })
    return Object.fromEntries(entries)
  }
  if (type === 'address') {
    if (typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)) return value.toLowerCase()
    throw new Unreadable(`${path} is not an address`)
  }
  if (type === 'bool') {
    if (typeof value === 'boolean') return value
    throw new Unreadable(`${path} is not true or false`)
  }
  if (type === 'string') {
    if (typeof value === 'string') return value
    throw new Unreadable(`${path} is not a string`)
  }
  if (type.startsWith('bytes')) {
    if (typeof value === 'string' && /^0x([0-9a-fA-F]{2})*$/.test(value)) return value
    throw new Unreadable(`${path} is not hex bytes with the 0x prefix`)
  }
  // An integer: ethers checks the range of the type.
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^(-?[0-9]+|0x[0-9a-fA-F]+)$/.test(value)) return value
  throw new Unreadable(`${path} is not an integer`)
}
