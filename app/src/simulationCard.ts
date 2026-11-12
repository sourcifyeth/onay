// The words and the groups of the effects card: the amounts, the
// allowances, the warnings, the state changes by contract with the names
// of the storage layout, and the events with the names of the verified
// ABI. This module has no browser or Tauri calls, so the tests run it.

import { decodeEvent, decodeStandardEvent, type DecodedEvent } from './clear-signing/decode.ts'
import { amountText } from './context/run.ts'
import type { Hex } from './messages.ts'
import { verdictOf, type Contract } from './gates/contracts.ts'
import type { AssetChange, Effects, EventLog, EventWarning, Permission, TokenFacts } from './gates/effects.ts'
import { nameSlots, type NamedSlot } from './gates/layout.ts'
import type { Simulation } from './gates/simulation.ts'
import { short } from './gates/words.ts'

// An allowance above this is more than any token has: "Unlimited".
export const UNLIMITED = 1n << 255n

// The code that ran on the storage of an address: the implementations
// of a proxy or the facets of a diamond first, then its own code.
export function codesOn(address: Hex, simulation: Simulation): Hex[] {
  const others = simulation.touched
    .filter((touched) => touched.address !== address && touched.contexts.includes(address))
    .map((touched) => touched.address)
  return [...others, address]
}

function contractOf(address: Hex, contracts: Contract[]): Contract | undefined {
  return contracts.find((contract) => contract.address === address)
}

// What the Sourcify gate found for the code at an address: the verified
// result, or null.
function verifiedOf(address: Hex, contracts: Contract[]) {
  const contract = contractOf(address, contracts)
  return contract?.sourcify.status === 'passed' ? contract.sourcify.value : null
}

// The source code of a contract: verified here, not verified, or not
// known yet.
export type SourceState = 'verified' | 'unverified' | 'pending'

export function sourceOf(address: Hex, contracts: Contract[]): SourceState {
  const contract = contractOf(address, contracts)
  if (!contract) return 'unverified'
  const verdict = verdictOf(contract)
  if (verdict === 'pending') return 'pending'
  return verdict === 'passed' && contract.sourcify.status === 'passed' ? 'verified' : 'unverified'
}

// The name of an address on the card: "you", or the name of the
// contract from its verified source code.
export function nameOf(address: Hex, contracts: Contract[], you: Hex): string | null {
  if (address === you) return 'you'
  return verifiedOf(address, contracts)?.claim.name ?? null
}

// The symbol of a token, or its short address if it gave none.
export function tickerOf(token: Hex, facts: TokenFacts | undefined): string {
  return facts?.symbol ?? short(token)
}

// An amount of a token. A token that gave no decimals counts in units.
export function tokenAmount(value: bigint, token: Hex, facts: TokenFacts | undefined): string {
  const amount = amountText(value < 0n ? -value : value, facts?.decimals ?? 0)
  return `${amount} ${tickerOf(token, facts)}`
}

// One asset row in words, without the sign: "1.5 ETH", "250 USDC",
// "BAYC #3941", "3 × ITEM #5".
export function assetText(change: AssetChange, tokens: Effects['tokens']): string {
  const { asset } = change
  const size = change.delta < 0n ? -change.delta : change.delta
  if (asset.kind === 'native') return `${amountText(size, 18)} ETH`
  const facts = tokens[asset.token]
  if (asset.kind === 'erc20') return tokenAmount(size, asset.token, facts)
  const ticker = tickerOf(asset.token, facts)
  if (asset.id === null) return `${size} ${ticker} ${size === 1n ? 'NFT' : 'NFTs'}`
  const item = `${ticker} #${asset.id}`
  return size === 1n ? item : `${size} × ${item}`
}

export function isUnlimited(permission: Permission): boolean {
  return permission.kind === 'all' || (permission.kind === 'amount' && permission.after >= UNLIMITED)
}

// What a spender may take after the run.
export function allowanceText(permission: Permission, tokens: Effects['tokens']): string {
  const facts = tokens[permission.token]
  const ticker = tickerOf(permission.token, facts)
  if (permission.after === 0n) return ticker
  if (permission.kind === 'all') return `All your ${ticker}`
  if (permission.kind === 'one') return `${ticker} #${permission.id}`
  if (permission.after >= UNLIMITED) return `Unlimited ${ticker}`
  return tokenAmount(permission.after, permission.token, facts)
}

// Your balance next to an allowance.
export function balanceText(permission: Permission, tokens: Effects['tokens']): string | null {
  if (permission.balance === null) return null
  const facts = tokens[permission.token]
  if (permission.kind === 'amount') return tokenAmount(permission.balance, permission.token, facts)
  return `${permission.balance} ${tickerOf(permission.token, facts)}`
}

// The title of a warning: what the event claims.
export function warningText(warning: EventWarning, tokens: Effects['tokens']): string {
  const facts = tokens[warning.token]
  const what =
    warning.amount !== null
      ? tokenAmount(warning.amount, warning.token, facts)
      : `${tickerOf(warning.token, facts)} #${warning.id ?? '?'}`
  const verb = warning.direction === 'in' ? 'receive' : 'send'
  return `An event says that you ${verb} ${what}, but your balance does not change`
}

// The tokens whose change the card shows in its rows.
function shownTokens(effects: Effects): Set<Hex> {
  const tokens = new Set<Hex>()
  for (const { asset } of effects.assets) if (asset.kind !== 'native') tokens.add(asset.token)
  for (const permission of effects.permissions) tokens.add(permission.token)
  return tokens
}

// The contracts that the run wrote to, apart from the tokens of the
// rows: what else the transaction changes.
export function otherContracts(simulation: Simulation, effects: Effects | null): Hex[] {
  const shown = effects ? shownTokens(effects) : new Set<Hex>()
  const you = effects?.you
  const others: Hex[] = []
  for (const { address } of simulation.diff.slots) {
    if (address !== you && !shown.has(address) && !others.includes(address)) others.push(address)
  }
  return others
}

export type ContractChanges = { address: Hex; slots: NamedSlot[] }

// The changed slots of each contract, named with the layouts of the
// verified code that ran on its storage.
export function stateChanges(simulation: Simulation, contracts: Contract[]): ContractChanges[] {
  const addresses = [...new Set(simulation.diff.slots.map((change) => change.address))]
  return addresses.map((address) => {
    const layouts = codesOn(address, simulation)
      .map((code) => verifiedOf(code, contracts)?.storageLayout)
      .filter((layout) => layout !== undefined)
    const changes = simulation.diff.slots.filter((change) => change.address === address)
    return { address, slots: nameSlots(layouts, changes) }
  })
}

export type EventRow = {
  log: EventLog
  decoded: DecodedEvent | null
  // Decoded with the events of the token standards, not with a verified
  // ABI.
  standard: boolean
}

// Each event of the run, decoded with the verified ABI of the code that
// emitted it, else with the events of the token standards.
export function eventRows(simulation: Simulation, contracts: Contract[]): EventRow[] {
  return simulation.calls
    .flatMap((call) => call.logs)
    .map((log) => {
      for (const code of codesOn(log.address, simulation)) {
        const abi = verifiedOf(code, contracts)?.abi
        const decoded = abi ? decodeEvent(abi, log) : null
        if (decoded) return { log, decoded, standard: false }
      }
      const decoded = decodeStandardEvent(log)
      return { log, decoded, standard: decoded !== null }
    })
}

// The fee in words, and how Onay got the price.
export function feeNote(simulation: Simulation): string {
  const { fee, header } = simulation
  const gas = `${fee.gas.toLocaleString('en-US')} gas`
  if (fee.fromRequest) return `${gas} at the gas price of the request.`
  return `${gas} at the base fee of block ${header.number.toLocaleString('en-US')}. Your wallet adds a tip, so the fee is a little higher.`
}

export function feeOf(simulation: Simulation): bigint {
  return simulation.fee.gas * simulation.fee.price
}
