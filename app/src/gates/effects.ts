// What a transaction does to the assets of its sender: what the sender
// sends, receives, and allows others to spend. The amounts come from the
// tokens, not from the events: a probe calls balanceOf, ownerOf,
// allowance and the like on the state before the run and on the state
// after it. The events and the written storage only say which contracts
// to ask. A contract can emit any event, so an event that names the
// sender without a change of a balance is a warning. This module has no
// EVM in it: the probe is a parameter.

import { AbiCoder, id } from 'ethers'
import type { Hex } from '../messages.ts'
import type { Call } from './request.ts'
import type { StateDiff } from './state.ts'

// One event of the run, as the EVM gives it.
export type EventLog = { address: Hex; topics: Hex[]; data: Hex }

export type Asset =
  | { kind: 'native' }
  | { kind: 'erc20'; token: Hex }
  // Id null: the count of the tokens changed, and no event says which.
  | { kind: 'nft'; standard: 'erc721' | 'erc1155'; token: Hex; id: bigint | null }

// One asset of the sender that the run changes. Negative: the sender
// sends it.
export type AssetChange = {
  asset: Asset
  delta: bigint
  // The other account, only when the call of the request is itself the
  // transfer.
  counterparty?: Hex
}

// A right over the assets of the sender that the run changes. amount: an
// ERC-20 allowance. all: every NFT of the collection. one: one NFT.
export type Permission = {
  token: Hex
  spender: Hex
  kind: 'amount' | 'all' | 'one'
  // The allowance, or 1 and 0 for all and one.
  before: bigint
  after: bigint
  id?: bigint
  // The balance of the sender after the run. Null if the token did not
  // answer.
  balance: bigint | null
}

// What a token says about itself. Each value is a claim of its code.
// Null if the token did not answer.
export type TokenFacts = { symbol: string | null; name: string | null; decimals: number | null }

// An event that says that the sender sends or receives a token, while
// the balance of the sender at that token does not change.
export type EventWarning = {
  token: Hex
  direction: 'in' | 'out'
  // The amount of an ERC-20 event, or the id of an NFT.
  amount: bigint | null
  id: bigint | null
}

export type Effects = {
  you: Hex
  assets: AssetChange[]
  permissions: Permission[]
  tokens: Record<Hex, TokenFacts>
  warnings: EventWarning[]
  // How many calls the probes made.
  probes: number
}

// A read-only call on the state before the run or after it. The return
// data, or null if the call failed.
export type Probe = (to: Hex, data: Hex, when: 'before' | 'after') => Promise<Hex | null>

export type EffectsInput = {
  you: Hex
  calls: Call[]
  // The events of all calls, in order.
  logs: EventLog[]
  diff: StateDiff
}

// A swap through an aggregator writes to a few dozen contracts. Past
// this, the rest are not asked.
export const MAX_TOKENS = 40

const topic = (signature: string) => id(signature) as Hex
const selector = (signature: string) => id(signature).slice(0, 10) as Hex

export const TOPICS = {
  transfer: topic('Transfer(address,address,uint256)'),
  approval: topic('Approval(address,address,uint256)'),
  approvalForAll: topic('ApprovalForAll(address,address,bool)'),
  transferSingle: topic('TransferSingle(address,address,address,uint256,uint256)'),
  transferBatch: topic('TransferBatch(address,address,address,uint256[],uint256[])'),
}

const SELECTORS = {
  balanceOf: selector('balanceOf(address)'),
  balanceOfId: selector('balanceOf(address,uint256)'),
  ownerOf: selector('ownerOf(uint256)'),
  allowance: selector('allowance(address,address)'),
  getApproved: selector('getApproved(uint256)'),
  isApprovedForAll: selector('isApprovedForAll(address,address)'),
  supportsInterface: selector('supportsInterface(bytes4)'),
  symbol: selector('symbol()'),
  name: selector('name()'),
  decimals: selector('decimals()'),
  transfer: selector('transfer(address,uint256)'),
  transferFrom: selector('transferFrom(address,address,uint256)'),
  safeTransferFrom: selector('safeTransferFrom(address,address,uint256)'),
  safeTransferFromData: selector('safeTransferFrom(address,address,uint256,bytes)'),
  safeTransferFrom1155: selector('safeTransferFrom(address,address,uint256,uint256,bytes)'),
}

const ERC721_INTERFACE = '0x80ac58cd'
const ZERO: Hex = '0x0000000000000000000000000000000000000000'

const word = (value: bigint | Hex) =>
  (typeof value === 'bigint' ? value.toString(16) : value.slice(2).toLowerCase()).padStart(64, '0')

function encode(fn: Hex, ...args: (bigint | Hex)[]): Hex {
  return `${fn}${args.map(word).join('')}` as Hex
}

// The first word of return data as a number. Null if the data is shorter
// than a word: an address without code returns no data at all.
function uintOf(data: Hex | null): bigint | null {
  if (data === null || data.length < 66) return null
  return BigInt(data.slice(0, 66))
}

// The first word as an address. Null if its first 12 bytes are not zero.
function addressOf(data: Hex | null): Hex | null {
  if (data === null || data.length < 66 || !/^0x0{24}/.test(data)) return null
  return `0x${data.slice(26, 66).toLowerCase()}` as Hex
}

const topicAddress = (value: Hex | undefined): Hex | null => (value ? addressOf(value) : null)

// A string as an ABI string, or as a bytes32 that some old tokens give.
function textOf(data: Hex | null): string | null {
  if (data === null || data.length < 66) return null
  try {
    const [text] = AbiCoder.defaultAbiCoder().decode(['string'], data)
    if (typeof text === 'string') return clean(text)
  } catch {
    // Not an ABI string: try the bytes32 form.
  }
  if (data.length !== 66) return null
  const bytes = data.slice(2).replace(/(00)+$/, '')
  const text = new TextDecoder().decode(Uint8Array.from(bytes.match(/../g) ?? [], (pair) => parseInt(pair, 16)))
  return clean(text)
}

// The token writes the text, so only printable characters stay, and at
// most 64 of them.
function clean(text: string): string | null {
  // oxlint-disable-next-line no-control-regex
  const printable = text.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim()
  return printable.length > 0 ? printable.slice(0, 64) : null
}

export async function effectsOf(input: EffectsInput, probe: Probe): Promise<Effects> {
  const { you, logs, diff, calls } = input
  let probes = 0
  const ask = (to: Hex, data: Hex, when: 'before' | 'after') => {
    probes++
    return probe(to, data, when)
  }
  const both = async (to: Hex, data: Hex) => [await ask(to, data, 'before'), await ask(to, data, 'after')] as const

  const assets: AssetChange[] = []
  const mine = diff.accounts.find((account) => account.address === you)
  if (mine && mine.balance.after !== mine.balance.before) {
    assets.push({ asset: { kind: 'native' }, delta: mine.balance.after - mine.balance.before })
  }

  // The events that name the sender come first, then the contracts with
  // written storage, then the targets of the calls.
  const names = (log: EventLog) => log.topics.slice(1, 4).some((value) => topicAddress(value) === you)
  const candidates: Hex[] = []
  const consider = (address: Hex) => {
    if (address !== you && !candidates.includes(address)) candidates.push(address)
  }
  for (const log of logs) if (log.topics[0] === TOPICS.transfer && names(log)) consider(log.address)
  for (const log of logs) {
    if ((log.topics[0] === TOPICS.transferSingle || log.topics[0] === TOPICS.transferBatch) && names(log)) {
      consider(log.address)
    }
  }
  for (const slot of diff.slots) consider(slot.address)
  for (const call of calls) consider(call.to)

  for (const token of candidates.slice(0, MAX_TOKENS)) {
    const at = logs.filter((log) => log.address === token)
    const nftIds = unique(
      at
        .filter((log) => log.topics[0] === TOPICS.transfer && log.topics.length === 4 && names(log))
        .map((log) => BigInt(log.topics[3])),
    )
    const multiIds = unique(at.filter((log) => names(log)).flatMap((log) => idsOf1155(log)))
    if (nftIds.length > 0) {
      for (const tokenId of nftIds) {
        const [before, after] = await both(token, encode(SELECTORS.ownerOf, tokenId))
        const was = addressOf(before) === you
        const is = addressOf(after) === you
        if (was === is) continue
        const asset: Asset = { kind: 'nft', standard: 'erc721', token, id: tokenId }
        assets.push({ asset, delta: is ? 1n : -1n })
      }
      continue
    }
    if (multiIds.length > 0) {
      for (const tokenId of multiIds) {
        const [before, after] = await both(token, encode(SELECTORS.balanceOfId, you, tokenId))
        const [b, a] = [uintOf(before), uintOf(after)]
        if (b === null || a === null || a === b) continue
        assets.push({ asset: { kind: 'nft', standard: 'erc1155', token, id: tokenId }, delta: a - b })
      }
      continue
    }
    const [before, after] = await both(token, encode(SELECTORS.balanceOf, you))
    const [b, a] = [uintOf(before), uintOf(after)]
    if (b === null || a === null || a === b) continue
    const nft =
      at.some((log) => log.topics[0] === TOPICS.transfer && log.topics.length === 4) ||
      uintOf(
        await ask(token, encode(SELECTORS.supportsInterface, `${ERC721_INTERFACE}${'0'.repeat(56)}` as Hex), 'after'),
      ) === 1n
    const asset: Asset = nft ? { kind: 'nft', standard: 'erc721', token, id: null } : { kind: 'erc20', token }
    assets.push({ asset, delta: a - b })
  }

  const permissions: Permission[] = []
  const seen = new Set<string>()
  const grant = async (permission: Omit<Permission, 'balance'>) => {
    const key = `${permission.token} ${permission.spender} ${permission.kind} ${permission.id ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    const balance = uintOf(await ask(permission.token, encode(SELECTORS.balanceOf, you), 'after'))
    permissions.push({ ...permission, balance })
  }
  for (const log of logs) {
    if (topicAddress(log.topics[1]) !== you) continue
    const token = log.address
    const spender = topicAddress(log.topics[2])
    if (spender === null) continue
    if (log.topics[0] === TOPICS.approval && log.topics.length === 3) {
      const key = `${token} ${spender} amount `
      if (seen.has(key)) continue
      const [before, after] = await both(token, encode(SELECTORS.allowance, you, spender))
      const [b, a] = [uintOf(before), uintOf(after)]
      if (b === null || a === null || a === b) continue
      await grant({ token, spender, kind: 'amount', before: b, after: a })
    } else if (log.topics[0] === TOPICS.approval && log.topics.length === 4) {
      // A transfer clears the approval of the NFT with an event to the
      // zero address. That is not a right of anyone.
      if (spender === ZERO) continue
      const tokenId = BigInt(log.topics[3])
      const [before, after] = await both(token, encode(SELECTORS.getApproved, tokenId))
      if (addressOf(after) !== spender || addressOf(before) === spender) continue
      await grant({ token, spender, kind: 'one', before: 0n, after: 1n, id: tokenId })
    } else if (log.topics[0] === TOPICS.approvalForAll) {
      const [before, after] = await both(token, encode(SELECTORS.isApprovedForAll, you, spender))
      const [b, a] = [uintOf(before), uintOf(after)]
      if (b === null || a === null || a === b) continue
      await grant({ token, spender, kind: 'all', before: b === 0n ? 0n : 1n, after: a === 0n ? 0n : 1n })
    }
  }

  const changed = new Set(assets.flatMap(({ asset }) => (asset.kind === 'native' ? [] : [asset.token])))
  const warnings: EventWarning[] = []
  for (const log of logs) {
    const claim = claimOf(log, you)
    if (!claim || changed.has(log.address)) continue
    if (warnings.some((w) => w.token === log.address && w.direction === claim.direction)) continue
    warnings.push({ token: log.address, ...claim })
  }

  const tokens: Record<Hex, TokenFacts> = {}
  const described = [
    ...changed,
    ...permissions.map((permission) => permission.token),
    ...warnings.map((warning) => warning.token),
  ]
  for (const token of described) {
    if (tokens[token]) continue
    const symbol = textOf(await ask(token, SELECTORS.symbol, 'after'))
    const name = textOf(await ask(token, SELECTORS.name, 'after'))
    const decimals = uintOf(await ask(token, SELECTORS.decimals, 'after'))
    tokens[token] = { symbol, name, decimals: decimals !== null && decimals <= 77n ? Number(decimals) : null }
  }

  return { you, assets: withCounterparty(assets, calls, you), permissions, tokens, warnings, probes }
}

// What a transfer event claims about the sender: the direction, and the
// amount or the id. Null if it does not name the sender, or moves
// nothing.
function claimOf(log: EventLog, you: Hex): Omit<EventWarning, 'token'> | null {
  if (log.topics[0] === TOPICS.transfer && (log.topics.length === 3 || log.topics.length === 4)) {
    const from = topicAddress(log.topics[1])
    const to = topicAddress(log.topics[2])
    if (from === to || (from !== you && to !== you)) return null
    const direction = to === you ? 'in' : 'out'
    if (log.topics.length === 4) return { direction, amount: null, id: BigInt(log.topics[3]) }
    const amount = uintOf(log.data)
    if (amount === null || amount === 0n) return null
    return { direction, amount, id: null }
  }
  if (log.topics[0] === TOPICS.transferSingle && log.topics.length === 4) {
    const from = topicAddress(log.topics[2])
    const to = topicAddress(log.topics[3])
    if (from === to || (from !== you && to !== you)) return null
    const tokenId = uintOf(log.data)
    return { direction: to === you ? 'in' : 'out', amount: null, id: tokenId }
  }
  return null
}

// The ids of an ERC-1155 event. Empty for any other event.
function idsOf1155(log: EventLog): bigint[] {
  if (log.topics[0] === TOPICS.transferSingle) {
    const tokenId = uintOf(log.data)
    return tokenId === null ? [] : [tokenId]
  }
  if (log.topics[0] === TOPICS.transferBatch) {
    try {
      const [ids] = AbiCoder.defaultAbiCoder().decode(['uint256[]', 'uint256[]'], log.data)
      return (ids as bigint[]).map((value) => BigInt(value))
    } catch {
      return []
    }
  }
  return []
}

// A plain transfer names its receiver: an ETH transfer without data, or a
// call of transfer or transferFrom on the token itself. A row of a
// transaction that does more names nobody, since the call alone does not
// say who gets what.
function withCounterparty(assets: AssetChange[], calls: Call[], you: Hex): AssetChange[] {
  if (calls.length !== 1) return assets
  const [call] = calls
  const receiver = receiverOf(call, you)
  if (receiver === null) return assets
  return assets.map((change) => {
    if (change.delta >= 0n) return change
    const native = change.asset.kind === 'native' && call.data === '0x'
    const token = change.asset.kind !== 'native' && change.asset.token === call.to && call.data !== '0x'
    return native || token ? { ...change, counterparty: receiver } : change
  })
}

function receiverOf(call: Call, you: Hex): Hex | null {
  if (call.data === '0x') return call.value > 0n ? call.to : null
  const fn = call.data.slice(0, 10)
  const arg = (index: number) => {
    const value = call.data.slice(10 + index * 64, 10 + (index + 1) * 64)
    return value.length === 64 ? addressOf(`0x${value}` as Hex) : null
  }
  if (fn === SELECTORS.transfer) return arg(0)
  const fromYou = [
    SELECTORS.transferFrom,
    SELECTORS.safeTransferFrom,
    SELECTORS.safeTransferFromData,
    SELECTORS.safeTransferFrom1155,
  ].includes(fn as Hex)
  if (fromYou && arg(0) === you) return arg(1)
  return null
}

function unique(values: bigint[]): bigint[] {
  return [...new Set(values)]
}
