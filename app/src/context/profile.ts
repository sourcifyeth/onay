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
import type { ChainValue, CodeKind } from './chain.ts'
import type { EtherscanCreation } from './etherscan.ts'
import type { Lookup } from './explorers.ts'
import type { GoPlusResult } from './goplus.ts'
import type { Hit } from './lists.ts'

// A deployment under this age, or a contract with fewer transactions,
// gets a hint in the review. It is not a verdict.
export const YOUNG_DAYS = 30
export const FEW_TRANSACTIONS = 100

const DAY = 24 * 60 * 60 * 1000

// A value and who claims it. `proof` is true only for a read with a proof
// through Helios. `source` names the source in words: 'Helios',
// 'Blockscout', 'Sourcify', a list, or '{host} without proof'.
export type Claimed<T> = { value: T; proof: boolean; source: string }

// A row of the profile.
export type Fact<T> = { state: 'pending' } | { state: 'unknown'; reason: string } | ({ state: 'known' } & Claimed<T>)

export type TokenHolding = {
  token: Hex
  // From a token list of the user if it lists the token, else from
  // Blockscout.
  symbol: Claimed<string | null>
  decimals: number | null
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
  // True when the chain gave the amount of each token.
  checked: boolean
}

export type Activity = {
  transactions: Fact<number>
  // Null value: no transaction went to the address.
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
}

export type Young = {
  // Set when the deployment is under YOUNG_DAYS old.
  days: number | null
  // Set when the count is under FEW_TRANSACTIONS.
  transactions: number | null
}

export type GoPlusFact = Fact<GoPlusResult> | { state: 'off' }

export type Profile = Activity & {
  address: Hex
  chainId: number
  name: Fact<string | null>
  deployment: Fact<Deployment>
  // Milliseconds since 1970.
  deployedAt: Fact<number>
  deployer: DeployerProfile
  // The allow and block lists that know the address. Each hit names its
  // list.
  lists: Fact<Hit[]>
  // The block-list hits, and a scam mark of Blockscout. Not empty: the
  // review shows a notice. The status of the request does not change.
  blocked: Claimed<string>[]
  security: { blockscout: Fact<'ok' | 'scam'>; goPlus: GoPlusFact }
  // Null when the contract is not young, or when nothing says so.
  young: Young | null
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
  etherscanFirst?: Lookup<FirstTransaction | null>
  balance?: Lookup<ChainValue<bigint>>
  tokenAmounts: Partial<Record<Hex, Lookup<ChainValue<bigint>>>>
}

export type ProfileReads = {
  address: Hex
  chainId: number
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
  deployer: HolderReads & { kind?: Lookup<ChainValue<CodeKind>>; hits?: Hit[] }
  hits?: Lookup<Hit[]>
  goPlus?: Lookup<GoPlusResult> | 'off'
  tokenLists: ListEntry[]
  // True once the run ended: a read that did not end is unknown.
  done: boolean
}

export const emptyHolder = (): HolderReads => ({ blockscout: {}, tokenAmounts: {} })

const PENDING = { state: 'pending' } as const
const unknown = (reason: string): Fact<never> => ({ state: 'unknown', reason })
const known = <T>(value: T, proof: boolean, source: string): Fact<T> => ({ state: 'known', value, proof, source })
const NOT_READ = 'not read'

export const chainSource = (proof: boolean, rpc: string) => (proof ? 'Helios' : `${rpc} without proof`)

// A lookup as a row. An absent lookup is pending while the run runs.
function fromLookup<T, U>(lookup: Lookup<T> | undefined, done: boolean, map: (value: T) => Fact<U>): Fact<U> {
  if (lookup === undefined) return done ? unknown(NOT_READ) : PENDING
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
  if (claim && claim !== 'pending' && claim.block !== null)
    return { block: claim.block, verified: false, source: claim.source }
  return null
}

function deploymentFacts(reads: ProfileReads): {
  deployment: Fact<Deployment>
  deployer: Fact<Hex>
  deployedAt: Fact<number>
} {
  const claim = chooseCreation(reads)
  if (claim === 'pending') return { deployment: PENDING, deployer: PENDING, deployedAt: PENDING }
  if (claim === null) {
    const etherscan = reads.etherscanCreation
    const reason =
      etherscan && !etherscan.ok
        ? `no source names the creation transaction · Etherscan: ${etherscan.reason}`
        : 'no source names the creation transaction'
    // Etherscan may still answer.
    const fact = !reads.done && etherscan === undefined ? PENDING : unknown(reason)
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
    deployment = PENDING
    deployer = PENDING
  } else {
    deployment = known({ transactionHash: claim.transactionHash, block: claim.block }, false, claim.source)
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
  // The first transaction to a contract that a transaction deployed is
  // its creation.
  const first = reads.contract.blockscout.firstTransaction
  if (first?.ok && first.value && first.value.hash === claim.transactionHash) {
    return known(first.value.time, false, 'Blockscout')
  }
  if (deployment.state === 'pending') return PENDING
  if (block && time === undefined && !reads.done) return PENDING
  if (time && !time.ok) return unknown(time.reason)
  return unknown(block ? NOT_READ : 'no source names the block of the deployment')
}

function holdingsOf(holder: HolderReads, reads: ProfileReads): Fact<Holdings> {
  return fromLookup(holder.blockscout.tokens, reads.done, (page) => {
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
      const decimals = fromList ? fromList.decimals : claim.decimals
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
    const checked = page.tokens.every((claim) => holder.tokenAmounts[claim.token]?.ok === true)
    return known({ tokens, more: page.more, checked }, false, 'Blockscout')
  })
}

function firstTransactionFact(holder: HolderReads, done: boolean): Fact<FirstTransaction | null> {
  const blockscout = holder.blockscout.firstTransaction
  if (blockscout?.ok) return known(blockscout.value, false, 'Blockscout')
  const etherscan = holder.etherscanFirst
  if (etherscan?.ok) return known(etherscan.value, false, 'Etherscan')
  if (blockscout === undefined || (etherscan === undefined && !done)) return done ? unknown(NOT_READ) : PENDING
  return unknown(etherscan ? `${blockscout.reason} · Etherscan: ${etherscan.reason}` : blockscout.reason)
}

function activityOf(holder: HolderReads, reads: ProfileReads): Activity {
  return {
    transactions: fromLookup(holder.blockscout.counters, reads.done, (count) => known(count, false, 'Blockscout')),
    firstTransaction: firstTransactionFact(holder, reads.done),
    eth: fromLookup(holder.balance, reads.done, (wei) =>
      known(wei.value, wei.proof, chainSource(wei.proof, reads.rpc)),
    ),
    tokens: holdingsOf(holder, reads),
  }
}

const unknownActivity = (fact: Fact<never>): Activity => ({
  transactions: fact,
  firstTransaction: fact,
  eth: fact,
  tokens: fact,
})

function deployerOf(reads: ProfileReads, address: Fact<Hex>): DeployerProfile {
  if (address.state !== 'known') {
    const fact = address.state === 'pending' ? PENDING : unknown('the deployer is not known')
    return { address, kind: fact, name: fact, ...unknownActivity(fact) }
  }
  const { deployer } = reads
  const label = deployer.hits?.find((hit) => hit.kind === 'allow')
  let name: Fact<string | null>
  if (label) name = known(label.label, false, label.list)
  else name = fromLookup(deployer.blockscout.address, reads.done, (claim) => known(claim.name, false, 'Blockscout'))
  return {
    address,
    kind: fromLookup(deployer.kind, reads.done, (kind) =>
      known(kind.value, kind.proof, chainSource(kind.proof, reads.rpc)),
    ),
    name,
    ...activityOf(deployer, reads),
  }
}

export function young(profile: Pick<Profile, 'deployedAt' | 'transactions'>, now: number): Young | null {
  const { deployedAt, transactions } = profile
  const days =
    deployedAt.state === 'known' && now - deployedAt.value < YOUNG_DAYS * DAY
      ? Math.max(0, Math.floor((now - deployedAt.value) / DAY))
      : null
  const count = transactions.state === 'known' && transactions.value < FEW_TRANSACTIONS ? transactions.value : null
  return days === null && count === null ? null : { days, transactions: count }
}

// The sources of the known values, in the order they first appear.
function sourcesOf(profile: Omit<Profile, 'sources'>): string[] {
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
  if (profile.lists.state === 'known') for (const hit of profile.lists.value) add(hit.list)
  return sources.filter((source) => source !== 'address lists')
}

export function buildProfile(reads: ProfileReads): Profile {
  const { deployment, deployer, deployedAt } = deploymentFacts(reads)
  const activity = activityOf(reads.contract, reads)
  const blockscoutAddress = reads.contract.blockscout.address
  const lists = fromLookup(reads.hits, reads.done, (hits) => known(hits, false, 'address lists'))
  const blocked: Claimed<string>[] = []
  if (lists.state === 'known') {
    for (const hit of lists.value)
      if (hit.kind === 'block') blocked.push({ value: hit.label, proof: false, source: hit.list })
  }
  if (blockscoutAddress?.ok && blockscoutAddress.value.scam) {
    blocked.push({ value: 'marked as scam', proof: false, source: 'Blockscout' })
  }
  const goPlus: GoPlusFact =
    reads.goPlus === 'off'
      ? { state: 'off' }
      : fromLookup(reads.goPlus, reads.done, (result) => known(result, false, 'GoPlus'))
  const profile: Omit<Profile, 'sources'> = {
    address: reads.address,
    chainId: reads.chainId,
    name: fromLookup(blockscoutAddress, reads.done, (claim) => known(claim.name, false, 'Blockscout')),
    deployment,
    deployedAt,
    deployer: deployerOf(reads, deployer),
    ...activity,
    lists,
    blocked,
    security: {
      blockscout: fromLookup(blockscoutAddress, reads.done, (claim) =>
        known(claim.scam ? ('scam' as const) : ('ok' as const), false, 'Blockscout'),
      ),
      goPlus,
    },
    young: young({ deployedAt, transactions: activity.transactions }, reads.now),
    explorer: reads.explorer,
    rpc: reads.rpc,
  }
  return { ...profile, sources: sourcesOf(profile) }
}
