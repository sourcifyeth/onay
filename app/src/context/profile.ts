// The profile of a contract that the request names: who deployed it and
// when, its activity, what it holds, and the lists that know it. Each
// value carries its source, and a proof mark only when the chain gate
// read it with a proof. `buildProfile` merges the reads into the rows
// and chooses the source of each row. No fetch, no browser.

import type { ListEntry } from '../clear-signing/tokenLists.ts'
import { listedOn } from '../clear-signing/tokenLists.ts'
import type { Creation, CreationRead } from '../gates/creation.ts'
import type { Deployment as SourcifyDeployment } from '../gates/sourcify.ts'
import type { Hex } from '../messages.ts'
import type { BlockscoutClaims, FirstTransaction } from './blockscout.ts'
import type { AccountState, ChainValue, CodeKind } from './chain.ts'
import type { EtherscanCreation } from './etherscan.ts'
import type { Lookup } from './explorers.ts'
import type { GoPlusResult } from './goplus.ts'
import type { ListAnswer } from './lists.ts'

// A deployment under this age gets a warning in the review. It is not a
// verdict.
export const YOUNG_DAYS = 30

const DAY = 24 * 60 * 60 * 1000

// A value and who claims it. `proof` is true only for a read with a proof
// through Helios. `source` names the source in words: 'Helios',
// 'Blockscout', 'Sourcify', a list, or '{host} without proof'.
export type Claimed<T> = { value: T; proof: boolean; source: string }

// A row of the profile. A pending row names the source it waits for.
export type Fact<T> =
  | { state: 'pending'; source: string }
  | { state: 'unknown'; reason: string }
  | ({ state: 'known' } & Claimed<T>)

export type TokenHolding = {
  token: Hex
  // From a token list of the user if it lists the token, else from
  // Blockscout.
  symbol: Claimed<string | null>
  // From the chain, else from a token list, else from Blockscout. Null
  // when no source names them: the amount shows in the smallest unit.
  decimals: Claimed<number> | null
  // The amount read from the chain, or the claim of Blockscout when the
  // read failed.
  amount: Claimed<bigint>
  // The claim of Blockscout, set only when the chain says otherwise.
  claimed: bigint | null
}

export type Holdings = {
  tokens: TokenHolding[]
  // Blockscout knows more tokens than these.
  more: boolean
  // True when the chain gave the amount and the decimals of each token.
  checked: boolean
}

// The nonce of an account: the number of transactions that it sent. A
// contract sends no transactions, so its nonce does not show.
export type NonceFact = Fact<bigint> | { state: 'contract' }

export type Activity = {
  nonce: NonceFact
  // Null value: the address has no transaction.
  firstTransaction: Fact<FirstTransaction | null>
  // In wei.
  eth: Fact<bigint>
  tokens: Fact<Holdings>
}

export type Deployment = { transactionHash: Hex; block: number | null }

export type DeployerProfile = Activity & {
  address: Fact<Hex>
  kind: Fact<CodeKind>
  // A label from an allow list, or the name that Blockscout gives.
  name: Fact<string | null>
  lists: Fact<ListAnswer>
}

export type GoPlusFact = Fact<GoPlusResult> | { state: 'off' }

// A block-list hit or a scam mark. `of` names the address that the list
// knows: the address of the card, or its deployer.
export type Blocked = Claimed<string> & { of: 'address' | 'deployer' }

// The context of an address that the request names and that has no code
// of its own: an account, or an account with a delegate (EIP-7702). Only
// the lists and GoPlus, no deployer, activity or tokens. Not empty
// `blocked`: the review shows a notice.
export type AccountProfile = {
  address: Hex
  chainId: number
  lists: Fact<ListAnswer>
  blocked: Blocked[]
  goPlus: GoPlusFact
  sources: string[]
}

export type Profile = Activity & {
  address: Hex
  chainId: number
  name: Fact<string | null>
  deployment: Fact<Deployment>
  // Milliseconds since 1970.
  deployedAt: Fact<number>
  deployer: DeployerProfile
  // The allow and block lists that know the address, and the enabled
  // lists that gave no answer. Each hit names its list. Say "not on any
  // list" only when both are empty.
  lists: Fact<ListAnswer>
  // The block-list hits of the contract and of its deployer, and a scam
  // mark of Blockscout. Not empty: the review shows a notice. The status
  // of the request does not change.
  blocked: Blocked[]
  security: { blockscout: Fact<'ok' | 'scam'>; goPlus: GoPlusFact }
  // The age of the deployment in days, when it is under YOUNG_DAYS. Null
  // when the contract is older, or when its age is not known.
  young: number | null
  // The names of the sources that gave a value, for the provenance line.
  sources: string[]
  // The host of the Blockscout API. Null when no instance covers the
  // chain.
  explorer: string | null
  // The host of the execution endpoint.
  rpc: string
}

// The reads of one address: the contract or its deployer. Undefined
// means that the read did not end yet.
export type HolderReads = {
  blockscout: Partial<BlockscoutClaims>
  // Set only when Etherscan was asked.
  etherscanTransactions?: Lookup<FirstTransaction | null>
  account?: Lookup<ChainValue<AccountState>>
  tokenAmounts: Partial<Record<Hex, Lookup<ChainValue<bigint>>>>
  tokenDecimals: Partial<Record<Hex, Lookup<ChainValue<number>>>>
}

// The reads of an address without code. Undefined means that the read
// did not end yet.
export type AccountReads = {
  address: Hex
  chainId: number
  hits?: Lookup<ListAnswer>
  goPlus?: Lookup<GoPlusResult> | 'off'
  // True once the run ended: a read that did not end is unknown.
  done: boolean
}

export type ProfileReads = AccountReads & {
  // Milliseconds since 1970.
  now: number
  rpc: string
  explorer: string | null
  contract: HolderReads
  // What the Sourcify gate gave. Null when Sourcify has no claim.
  sourcify: {
    deployment: SourcifyDeployment | null
    creation: Creation | null
    // True when the gate tried to read the creation transaction.
    read: boolean
  } | null
  // Set only when Etherscan was asked.
  etherscanCreation?: Lookup<EtherscanCreation | null>
  // The read of the creation transaction that a claim names, when the
  // Sourcify gate did not read one.
  creationRead?: CreationRead
  blockTime?: Lookup<ChainValue<number>>
  deployer: HolderReads & { kind?: Lookup<ChainValue<CodeKind>>; hits?: Lookup<ListAnswer> }
  tokenLists: ListEntry[]
}

export const emptyHolder = (): HolderReads => ({ blockscout: {}, tokenAmounts: {}, tokenDecimals: {} })

const pending = (source: string): Fact<never> => ({ state: 'pending', source })
const unknown = (reason: string): Fact<never> => ({ state: 'unknown', reason })
const known = <T>(value: T, proof: boolean, source: string): Fact<T> => ({ state: 'known', value, proof, source })
const NOT_READ = 'not read'
// The source of a value that the chain gives, before the read ends.
export const CHAIN = 'the chain'
export const LISTS = 'the address lists'

export const chainSource = (proof: boolean, rpc: string) => (proof ? 'Helios' : `${rpc} without proof`)

// A lookup as a row. An absent lookup is pending while the run runs, and
// names the source it waits for.
function fromLookup<T, U>(
  lookup: Lookup<T> | undefined,
  done: boolean,
  source: string,
  map: (value: T) => Fact<U>,
): Fact<U> {
  if (lookup === undefined) return done ? unknown(NOT_READ) : pending(source)
  return lookup.ok ? map(lookup.value) : unknown(lookup.reason)
}

export type CreationClaim = { source: string; transactionHash: Hex; deployer: Hex | null; block: number | null }

// The claim of the creation transaction, by the order of the plan:
// Sourcify, then Blockscout, then Etherscan. 'pending' while a source
// that comes first has not answered yet.
export function chooseCreation(reads: ProfileReads): CreationClaim | 'pending' | null {
  const deployment = reads.sourcify?.deployment
  if (deployment) {
    return {
      source: 'Sourcify',
      transactionHash: deployment.transactionHash.toLowerCase() as Hex,
      deployer: deployment.deployer.toLowerCase() as Hex,
      block: deployment.blockNumber,
    }
  }
  const address = reads.contract.blockscout.address
  if (address === undefined && !reads.done) return 'pending'
  if (address?.ok && address.value.creationTransaction) {
    return {
      source: 'Blockscout',
      transactionHash: address.value.creationTransaction,
      deployer: address.value.creator,
      block: null,
    }
  }
  const etherscan = reads.etherscanCreation
  if (etherscan === undefined) return null
  if (etherscan.ok && etherscan.value) {
    return {
      source: 'Etherscan',
      transactionHash: etherscan.value.transactionHash,
      deployer: etherscan.value.deployer,
      block: etherscan.value.block,
    }
  }
  return null
}

// The creation transaction read from the chain, by the gate or by the
// profile. Null if none was read.
export function creationOf(reads: ProfileReads): Creation | null {
  return reads.sourcify?.creation ?? reads.creationRead?.creation ?? null
}

// True when the profile still waits for a read of the creation
// transaction.
function creationPending(reads: ProfileReads, claim: CreationClaim): boolean {
  if (reads.done || creationOf(reads)) return false
  if (claim.source === 'Sourcify' && reads.sourcify?.read) return false
  return reads.creationRead === undefined
}

// The block of the deployment, and whether a read with proof gave it.
export function deploymentBlock(reads: ProfileReads): { block: number; verified: boolean; source: string } | null {
  const creation = creationOf(reads)
  if (creation)
    return {
      block: creation.blockNumber,
      verified: creation.verified,
      source: chainSource(creation.verified, reads.rpc),
    }
  const claim = chooseCreation(reads)
  if (!claim || claim === 'pending') return null
  const block = claimedBlock(reads, claim)
  return block === null ? null : { block, verified: false, source: claim.source }
}

// The block of a claimed creation transaction: from the claim, else from
// the read of the transaction. A factory deployment gives no creation,
// but the chain still gives the block of the transaction.
const claimedBlock = (reads: ProfileReads, claim: CreationClaim): number | null =>
  claim.block ?? reads.creationRead?.block ?? null

function deploymentFacts(reads: ProfileReads): {
  deployment: Fact<Deployment>
  deployer: Fact<Hex>
  deployedAt: Fact<number>
} {
  const claim = chooseCreation(reads)
  if (claim === 'pending') {
    const fact = pending('Blockscout')
    return { deployment: fact, deployer: fact, deployedAt: fact }
  }
  if (claim === null) {
    const etherscan = reads.etherscanCreation
    const blockscout = reads.contract.blockscout.address
    // A source that failed is named, not counted as a source without a
    // claim.
    let reason =
      blockscout?.ok === false ? `Blockscout: ${blockscout.reason}` : 'no source names the creation transaction'
    if (etherscan && !etherscan.ok) reason += ` · Etherscan: ${etherscan.reason}`
    // Etherscan may still answer.
    const fact = !reads.done && etherscan === undefined ? pending('Etherscan') : unknown(reason)
    return { deployment: fact, deployer: fact, deployedAt: fact }
  }
  const creation = creationOf(reads)
  let deployment: Fact<Deployment>
  let deployer: Fact<Hex>
  if (creation) {
    const source = chainSource(creation.verified, reads.rpc)
    deployment = known(
      { transactionHash: creation.transactionHash, block: creation.blockNumber },
      creation.verified,
      source,
    )
    deployer = known(creation.deployer.toLowerCase() as Hex, creation.verified, source)
  } else if (creationPending(reads, claim)) {
    deployment = pending(CHAIN)
    deployer = pending(CHAIN)
  } else {
    deployment = known(
      { transactionHash: claim.transactionHash, block: claimedBlock(reads, claim) },
      false,
      claim.source,
    )
    deployer = claim.deployer
      ? known(claim.deployer, false, claim.source)
      : unknown(`${claim.source} names no deployer`)
  }
  return { deployment, deployer, deployedAt: deployedAtFact(reads, claim, deployment) }
}

function deployedAtFact(reads: ProfileReads, claim: CreationClaim, deployment: Fact<Deployment>): Fact<number> {
  const block = deploymentBlock(reads)
  const time = reads.blockTime
  if (block && time?.ok) {
    // The time of a claimed block is the claim of its source.
    const proof = block.verified && time.value.proof
    const source = block.verified ? chainSource(time.value.proof, reads.rpc) : block.source
    return known(time.value.value, proof, source)
  }
  const etherscan = reads.etherscanCreation
  if (etherscan?.ok && etherscan.value?.time != null && etherscan.value.transactionHash === claim.transactionHash) {
    return known(etherscan.value.time, false, 'Etherscan')
  }
  // The first transaction of a contract that a transaction deployed is
  // its creation.
  const first = reads.contract.blockscout.transactions
  if (first?.ok && first.value && first.value.hash === claim.transactionHash) {
    return known(first.value.time, false, 'Blockscout')
  }
  if (deployment.state === 'pending') return pending(deployment.source)
  if (block && time === undefined && !reads.done) return pending(CHAIN)
  if (time && !time.ok) return unknown(time.reason)
  return unknown(block ? NOT_READ : 'no source names the block of the deployment')
}

// The decimals of a token: the read of the chain, else the token list,
// else the claim of Blockscout.
function decimalsOf(
  read: Lookup<ChainValue<number>> | undefined,
  rpc: string,
  fromList: { decimals: number } | undefined,
  list: string | undefined,
  claimed: number | null,
): Claimed<number> | null {
  if (read?.ok) return { value: read.value.value, proof: read.value.proof, source: chainSource(read.value.proof, rpc) }
  if (fromList) return { value: fromList.decimals, proof: false, source: list ?? 'token list' }
  return claimed === null ? null : { value: claimed, proof: false, source: 'Blockscout' }
}

function holdingsOf(holder: HolderReads, reads: ProfileReads): Fact<Holdings> {
  return fromLookup(holder.blockscout.tokens, reads.done, 'Blockscout', (page) => {
    const listed = listedOn(reads.tokenLists, reads.chainId)
    const tokens = page.tokens.map((claim): TokenHolding => {
      const lists = listed.get(claim.token)
      const fromList = lists
        ? reads.tokenLists
            .flatMap((entry) => entry.list?.tokens ?? [])
            .find((token) => token.chainId === reads.chainId && token.address === claim.token)
        : undefined
      const symbol: Claimed<string | null> = fromList
        ? { value: fromList.symbol, proof: false, source: lists?.[0] ?? 'token list' }
        : { value: claim.symbol, proof: false, source: 'Blockscout' }
      const decimals = decimalsOf(holder.tokenDecimals[claim.token], reads.rpc, fromList, lists?.[0], claim.decimals)
      const read = holder.tokenAmounts[claim.token]
      if (read?.ok) {
        return {
          token: claim.token,
          symbol,
          decimals,
          amount: {
            value: read.value.value,
            proof: read.value.proof,
            source: chainSource(read.value.proof, reads.rpc),
          },
          claimed: read.value.value === claim.value ? null : claim.value,
        }
      }
      return {
        token: claim.token,
        symbol,
        decimals,
        amount: { value: claim.value, proof: false, source: 'Blockscout' },
        claimed: null,
      }
    })
    const checked = page.tokens.every(
      (claim) => holder.tokenAmounts[claim.token]?.ok === true && holder.tokenDecimals[claim.token]?.ok === true,
    )
    return known({ tokens, more: page.more, checked }, false, 'Blockscout')
  })
}

// The first transaction: Blockscout, else Etherscan.
function firstFact(holder: HolderReads, done: boolean): Fact<FirstTransaction | null> {
  const blockscout = holder.blockscout.transactions
  if (blockscout?.ok) return known(blockscout.value, false, 'Blockscout')
  const etherscan = holder.etherscanTransactions
  if (etherscan?.ok) return known(etherscan.value, false, 'Etherscan')
  if (blockscout === undefined) return done ? unknown(NOT_READ) : pending('Blockscout')
  if (etherscan === undefined && !done) return pending('Etherscan')
  return unknown(etherscan ? `${blockscout.reason} · Etherscan: ${etherscan.reason}` : blockscout.reason)
}

// The nonce of an address whose code the chain gave. A contract has no
// nonce row.
function nonceOf(holder: HolderReads, reads: ProfileReads, kind: Fact<CodeKind>): NonceFact {
  if (kind.state === 'pending') return pending(kind.source)
  if (kind.state === 'unknown') return unknown('the code of the address is not known')
  if (kind.value === 'contract') return { state: 'contract' }
  return fromLookup(holder.account, reads.done, CHAIN, (state) =>
    known(state.value.nonce, state.proof, chainSource(state.proof, reads.rpc)),
  )
}

function activityOf(holder: HolderReads, reads: ProfileReads, nonce: NonceFact): Activity {
  return {
    nonce,
    firstTransaction: firstFact(holder, reads.done),
    eth: fromLookup(holder.account, reads.done, CHAIN, (state) =>
      known(state.value.balance, state.proof, chainSource(state.proof, reads.rpc)),
    ),
    tokens: holdingsOf(holder, reads),
  }
}

const unknownActivity = (fact: Fact<never>): Activity => ({
  nonce: fact,
  firstTransaction: fact,
  eth: fact,
  tokens: fact,
})

function deployerOf(reads: ProfileReads, address: Fact<Hex>): DeployerProfile {
  if (address.state !== 'known') {
    const fact = address.state === 'pending' ? pending(address.source) : unknown('the deployer is not known')
    return { address, kind: fact, name: fact, lists: fact, ...unknownActivity(fact) }
  }
  const { deployer } = reads
  const label = deployer.hits?.ok ? deployer.hits.value.hits.find((hit) => hit.kind === 'allow') : undefined
  let name: Fact<string | null>
  if (label) name = known(label.label, false, label.list)
  else
    name = fromLookup(deployer.blockscout.address, reads.done, 'Blockscout', (claim) =>
      known(claim.name, false, 'Blockscout'),
    )
  const kind: Fact<CodeKind> = fromLookup(deployer.kind, reads.done, CHAIN, (kind) =>
    known(kind.value, kind.proof, chainSource(kind.proof, reads.rpc)),
  )
  return {
    address,
    kind,
    name,
    lists: listsFact(deployer.hits, reads.done),
    ...activityOf(deployer, reads, nonceOf(deployer, reads, kind)),
  }
}

const listsFact = (hits: Lookup<ListAnswer> | undefined, done: boolean): Fact<ListAnswer> =>
  fromLookup(hits, done, LISTS, (answer) => known(answer, false, 'address lists'))

function blockedOf(lists: Fact<ListAnswer>, of: Blocked['of']): Blocked[] {
  if (lists.state !== 'known') return []
  return lists.value.hits
    .filter((hit) => hit.kind === 'block')
    .map((hit) => ({ value: hit.label, proof: false, source: hit.list, of }))
}

function goPlusOf(reads: AccountReads): GoPlusFact {
  return reads.goPlus === 'off'
    ? { state: 'off' }
    : fromLookup(reads.goPlus, reads.done, 'GoPlus', (result) => known(result, false, 'GoPlus'))
}

export function young(deployedAt: Fact<number>, now: number): number | null {
  if (deployedAt.state !== 'known' || now - deployedAt.value >= YOUNG_DAYS * DAY) return null
  return Math.max(0, Math.floor((now - deployedAt.value) / DAY))
}

// The sources of the known values, in the order they first appear.
function sourcesOf(profile: object, lists: Fact<ListAnswer>[]): string[] {
  const sources: string[] = []
  const add = (source: string) => {
    if (!sources.includes(source)) sources.push(source)
  }
  const visit = (value: unknown) => {
    if (typeof value !== 'object' || value === null) return
    const claim = value as { proof?: unknown; source?: unknown }
    if (typeof claim.proof === 'boolean' && typeof claim.source === 'string') add(claim.source)
    for (const child of Object.values(value)) visit(child)
  }
  visit(profile)
  for (const fact of lists) if (fact.state === 'known') for (const hit of fact.value.hits) add(hit.list)
  return sources.filter((source) => source !== 'address lists')
}

export function buildProfile(reads: ProfileReads): Profile {
  const { deployment, deployer, deployedAt } = deploymentFacts(reads)
  const activity = activityOf(reads.contract, reads, { state: 'contract' })
  const blockscoutAddress = reads.contract.blockscout.address
  const lists = listsFact(reads.hits, reads.done)
  const deployerProfile = deployerOf(reads, deployer)
  const blocked = blockedOf(lists, 'address')
  if (blockscoutAddress?.ok && blockscoutAddress.value.scam) {
    blocked.push({ value: 'marked as scam', proof: false, source: 'Blockscout', of: 'address' })
  }
  blocked.push(...blockedOf(deployerProfile.lists, 'deployer'))
  const deployerAddress = reads.deployer.blockscout.address
  if (deployer.state === 'known' && deployerAddress?.ok && deployerAddress.value.scam) {
    blocked.push({ value: 'marked as scam', proof: false, source: 'Blockscout', of: 'deployer' })
  }
  const profile: Omit<Profile, 'sources'> = {
    address: reads.address,
    chainId: reads.chainId,
    name: fromLookup(blockscoutAddress, reads.done, 'Blockscout', (claim) => known(claim.name, false, 'Blockscout')),
    deployment,
    deployedAt,
    deployer: deployerProfile,
    ...activity,
    lists,
    blocked,
    security: {
      blockscout: fromLookup(blockscoutAddress, reads.done, 'Blockscout', (claim) =>
        known(claim.scam ? ('scam' as const) : ('ok' as const), false, 'Blockscout'),
      ),
      goPlus: goPlusOf(reads),
    },
    young: young(deployedAt, reads.now),
    explorer: reads.explorer,
    rpc: reads.rpc,
  }
  return { ...profile, sources: sourcesOf(profile, [lists, deployerProfile.lists]) }
}

export function buildAccount(reads: AccountReads): AccountProfile {
  const lists = listsFact(reads.hits, reads.done)
  const account: Omit<AccountProfile, 'sources'> = {
    address: reads.address,
    chainId: reads.chainId,
    lists,
    blocked: blockedOf(lists, 'address'),
    goPlus: goPlusOf(reads),
  }
  return { ...account, sources: sourcesOf(account, [lists]) }
}
