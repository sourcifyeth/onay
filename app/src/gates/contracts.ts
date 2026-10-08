// The contracts of a request. The request names the first ones. A gate
// can find more: the implementation of a proxy, the facets of a diamond.
// Each address is in the list once. This module has no browser or Tauri
// calls, so the tests run it as it is.

import type { Hex } from '../messages.ts'
import type { ChainCode } from './chain.ts'
import type { GateState } from './gate.ts'

export type Contract = {
  address: Hex
  chain: GateState<ChainCode>
}

// A request touches a few contracts. A list without an end would never
// pass, so a gate that finds more than this fails.
export const MAX_CONTRACTS = 32

// Adds a contract that waits for its gates. Gives the same list if the
// address is in it already, and null if the list is full.
export function add(contracts: Contract[], address: Hex): Contract[] | null {
  const key = address.toLowerCase() as Hex
  if (contracts.some((contract) => contract.address === key)) return contracts
  if (contracts.length >= MAX_CONTRACTS) return null
  return [...contracts, { address: key, chain: { status: 'waiting' } }]
}

// The contracts that a request names. Null if there are too many.
export function initial(addresses: Hex[]): Contract[] | null {
  let contracts: Contract[] | null = []
  for (const address of addresses) {
    contracts = add(contracts, address)
    if (contracts === null) return null
  }
  return contracts
}

export function withChain(contracts: Contract[], address: Hex, chain: GateState<ChainCode>): Contract[] {
  return contracts.map((contract) => (contract.address === address ? { ...contract, chain } : contract))
}

// True while a gate of a contract waits or runs.
export function pending(contracts: Contract[]): boolean {
  return contracts.some(({ chain }) => chain.status === 'waiting' || chain.status === 'running')
}

export function passedCount(contracts: Contract[]): number {
  return contracts.filter(({ chain }) => chain.status === 'passed').length
}
