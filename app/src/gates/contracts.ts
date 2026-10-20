// The contracts of a request. The request names the first ones. The
// simulation finds the others: every contract that the calls reach. Each
// address is in the list once. This module has no browser or Tauri
// calls, so the tests run it as it is.

import type { Hex } from '../messages.ts'
import type { ChainCode } from './helios.ts'
import type { GateState } from './gate.ts'
import { failureOf } from './sourcify.ts'
import type { Verified } from './verify.ts'

// Where a contract comes from: the request names it, or the simulation
// found it on the way.
export type FoundBy = 'request' | 'simulation'

export type Contract = {
  address: Hex
  foundBy: FoundBy
  // Set on a contract whose code ran in the context of a named contract:
  // the implementation of a proxy, or the delegate of an EIP-7702 account.
  implementationOf?: Hex
  helios: GateState<ChainCode>
  sourcify: GateState<Verified>
}

type States = Omit<Contract, 'address' | 'foundBy' | 'implementationOf'>

// A request touches a few contracts. A list without an end would never
// pass, so a gate that finds more than this fails.
export const MAX_CONTRACTS = 100

// Adds a contract that waits for its gates. Gives the same list if the
// address is in it already, and null if the list is full.
export function add(contracts: Contract[], address: Hex, foundBy: FoundBy): Contract[] | null {
  const key = address.toLowerCase() as Hex
  if (contracts.some((contract) => contract.address === key)) return contracts
  if (contracts.length >= MAX_CONTRACTS) return null
  return [...contracts, { address: key, foundBy, helios: { status: 'waiting' }, sourcify: { status: 'waiting' } }]
}

// A contract whose code ran in the context of a named contract. It acts
// on the storage of that contract, so it counts as named and must pass
// like it, also when the simulation found it first: it keeps its
// states. Null if the list is full.
export function addImplementation(contracts: Contract[], named: Hex, implementation: Hex): Contract[] | null {
  const key = implementation.toLowerCase() as Hex
  const grown = add(contracts, key, 'request')
  if (grown === null) return null
  return grown.map((contract) =>
    contract.address === key ? { ...contract, foundBy: 'request', implementationOf: named } : contract,
  )
}

// The contracts that a request names. Null if there are too many.
export function initial(addresses: Hex[]): Contract[] | null {
  let contracts: Contract[] | null = []
  for (const address of addresses) {
    contracts = add(contracts, address, 'request')
    if (contracts === null) return null
  }
  return contracts
}

export function update(contracts: Contract[], address: Hex, change: Partial<States>): Contract[] {
  const key = address.toLowerCase()
  return contracts.map((contract) => (contract.address === key ? { ...contract, ...change } : contract))
}

// What the gates say about a contract. 'flagged': the request does not
// name the contract (and it is not the delegate of a named account), and
// Sourcify has nothing for it. The request can still pass, and the
// review says so.
export type Verdict = 'pending' | 'passed' | 'flagged' | 'failed'

export function verdictOf({ foundBy, helios, sourcify }: Contract): Verdict {
  const states = [helios, sourcify]
  if (states.some(({ status }) => status === 'failed')) {
    const unverified = helios.status === 'passed' && failureOf(sourcify)?.kind === 'not verified'
    return foundBy === 'simulation' && unverified ? 'flagged' : 'failed'
  }
  if (states.some(({ status }) => status === 'waiting' || status === 'running')) return 'pending'
  return 'passed'
}

// True while a gate of a contract waits or runs.
export function pending(contracts: Contract[]): boolean {
  return contracts.some((contract) => verdictOf(contract) === 'pending')
}

export function tally(contracts: Contract[]): Record<Verdict, number> {
  const counts = { pending: 0, passed: 0, flagged: 0, failed: 0 }
  for (const contract of contracts) counts[verdictOf(contract)]++
  return counts
}
