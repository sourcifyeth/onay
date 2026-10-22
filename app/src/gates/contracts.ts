// The contracts of a request. The request names the first ones. A gate
// can find more: the implementation of a proxy, the facets of a diamond.
// Each address is in the list once. This module has no browser or Tauri
// calls, so the tests run it as it is.

import type { Hex } from '../messages.ts'
import type { ChainCode } from './helios.ts'
import type { GateState } from './gate.ts'
import type { Verified } from './verify.ts'

export type Contract = {
  address: Hex
  // The proxy that names this contract as its implementation, if the
  // Sourcify gate found it that way.
  via?: Hex
  helios: GateState<ChainCode>
  sourcify: GateState<Verified>
}

type States = Omit<Contract, 'address'>

// A request touches a few contracts. A list without an end would never
// pass, so a gate that finds more than this fails.
export const MAX_CONTRACTS = 32

// Adds a contract that waits for its gates. Gives the same list if the
// address is in it already, and null if the list is full.
export function add(contracts: Contract[], address: Hex, via?: Hex): Contract[] | null {
  const key = address.toLowerCase() as Hex
  if (contracts.some((contract) => contract.address === key)) return contracts
  if (contracts.length >= MAX_CONTRACTS) return null
  const contract: Contract = { address: key, helios: { status: 'waiting' }, sourcify: { status: 'waiting' } }
  if (via) contract.via = via
  return [...contracts, contract]
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

export function update(contracts: Contract[], address: Hex, change: Partial<States>): Contract[] {
  const key = address.toLowerCase()
  return contracts.map((contract) => (contract.address === key ? { ...contract, ...change } : contract))
}

function states({ helios, sourcify }: Contract): GateState<unknown>[] {
  return [helios, sourcify]
}

// True while a gate of a contract waits or runs.
export function pending(contracts: Contract[]): boolean {
  return contracts.some((contract) =>
    states(contract).some(({ status }) => status === 'waiting' || status === 'running'),
  )
}

// The contracts for which each gate passed, or had nothing to check.
export function passedCount(contracts: Contract[]): number {
  return contracts.filter((contract) =>
    states(contract).every(({ status }) => status === 'passed' || status === 'skipped'),
  ).length
}
