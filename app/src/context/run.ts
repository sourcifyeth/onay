// The context of a verified request: what the block explorers claim
// about each contract, and the profile of each named contract. It runs
// once the verification ended, apart from the gates: no answer here
// changes the status of the request. The network, the chain, the lists,
// the settings and the clock come in as parameters, so a test drives a
// whole run with fakes.

import type { RegistryIndex } from '@ethereum-sourcify/clear-signing'
import type { ChainConfig } from '../chainList.ts'
import type { ListEntry } from '../clear-signing/tokenLists.ts'
import type { CreationReader } from '../gates/creation.ts'
import { errorText, type Fetch, type Log } from '../gates/gate.ts'
import type { TimedLine, Verification } from '../gates/run.ts'
import { delegateOf } from '../gates/simulation.ts'
import { claimOf } from '../gates/sourcify.ts'
import type { Hex } from '../messages.ts'
import {
  dayText,
  isNotFound,
  MAX_TOKENS,
  pageText,
  readBlockscoutClaims,
  type BlockscoutClaims,
  type ClaimPart,
} from './blockscout.ts'
import {
  accountState,
  blockTime,
  codeKind,
  tokenBalance,
  tokenDecimals,
  type ChainAccess,
  type ChainValue,
  type CodeKind,
} from './chain.ts'
import * as etherscan from './etherscan.ts'
import {
  blockscoutContract,
  blockscoutLink,
  ETHERSCAN_API,
  etherscanLink,
  etherscanSource,
  EXPLORER_HOSTS,
  EXPLORER_NAMES,
  explorersOf,
  linkable,
  RATE_LIMITED,
  statusText,
  type Explorer,
  type ExplorerHosts,
  type ExplorerStatus,
  type Lookup,
} from './explorers.ts'
import { addressSecurity, goPlusText, type GoPlusResult } from './goplus.ts'
import {
  askedFor,
  askedTokenLists,
  ERC7730_NAME,
  erc7730Hits,
  hitsFor,
  missingFor,
  missingText,
  missingTokenLists,
  tokenListHits,
  type ListAnswer,
  type ListState,
} from './lists.ts'
import {
  buildAccount,
  buildProfile,
  chainSource,
  chooseCreation,
  creationOf,
  deploymentBlock,
  emptyHolder,
  type AccountProfile,
  type AccountReads,
  type Claimed,
  type HolderReads,
  type Profile,
  type ProfileReads,
} from './profile.ts'
import type { ContextSettings } from './settings.ts'

export type ExplorerState = { status: 'running' } | { status: 'done'; result: ExplorerStatus }

export type ExplorerRow = {
  explorer: Explorer
  // The site of the explorer, as the user sees it.
  host: string
  // False for a host from the settings, not from the table of the app.
  builtIn: boolean
  // Null for a host that the app does not open.
  link: string | null
  state: ExplorerState
}

export type Context = {
  status: 'running' | 'done'
  // The rows of each contract with code. An empty list: no explorer
  // covers the chain.
  explorers: Partial<Record<Hex, ExplorerRow[]>>
  // The profile of each named contract with code (issue 22). A row that
  // waits for a read is 'pending' until the run ends.
  profiles: Partial<Record<Hex, Profile>>
  // The lists and GoPlus for each named address without code of its own
  // (an account, or an account with a delegate). No key is in both maps.
  accounts: Partial<Record<Hex, AccountProfile>>
  lines: TimedLine[]
}

export type ContextStore = {
  subscribe(listener: () => void): () => void
  getSnapshot(): Context
}

// A change of the settings, or of the lists. `read` is the snapshot of
// the lists that the current run read, null before it read one.
export type Change = { kind: 'settings' } | { kind: 'lists'; read: object | null; now: object }

// What a kept store does on a change: run again now, run again when it
// gets a listener, or nothing. A run that did not read the lists yet
// reads the new ones, and a run that read the same lists needs no new
// run.
export function changeAction(change: Change, watched: boolean): 'rerun' | 'later' | 'none' {
  if (change.kind === 'lists' && (change.read === null || change.read === change.now)) return 'none'
  return watched ? 'rerun' : 'later'
}

export type Deps = {
  fetch: Fetch
  settings(): ContextSettings
  // A monotonic clock for the log, in milliseconds.
  now(): number
  // The wall clock, in milliseconds since 1970.
  date(): number
  wait(ms: number): Promise<void>
  // The answers of this session that say verified or not verified, so
  // that a second request for the same contract asks no explorer again.
  cache: Map<string, ExplorerStatus>
  // The parts of the Blockscout claims of this session that answered,
  // and when the first of them came, in `date()` time.
  claims: Map<string, { at: number; parts: Partial<BlockscoutClaims> }>
  chainReaderFor(chain: ChainConfig): ChainAccess
  creationReaderFor(chain: ChainConfig, log: Log): CreationReader
  // The address lists, once the fetches that run now ended.
  lists(): Promise<ListState[]>
  registryIndex(): Promise<RegistryIndex>
  tokenLists(): ListEntry[]
}

// The Blockscout claims of the session are asked again after this time.
export const CLAIMS_TTL = 10 * 60 * 1000

// Each explorer gets at most this many requests at a time.
export const IN_FLIGHT = 2
// Etherscan allows 3 calls a second on a free key.
export const ETHERSCAN_GAP = 350

const definitive = (status: ExplorerStatus) => status.kind === 'verified' || status.kind === 'not verified'

const short = (hex: Hex) => `${hex.slice(0, 6)}…${hex.slice(-4)}`

// An amount in the smallest unit as a decimal number, with at most six
// decimals.
export function amountText(value: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals)
  const whole = value / unit
  const fraction = (value % unit).toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '')
  if (whole === 0n && fraction === '' && value > 0n) return 'under 0.000001'
  return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`
}

// The requests of one explorer: at most IN_FLIGHT at a time, with a gap
// between two, in the order they come. After a rate limit, the rest of
// the run asks this explorer nothing.
type Queue = {
  // Null: not asked, for the rate limit or because the run stopped.
  ask<T>(request: () => Promise<T>, limitedBy: (result: T) => boolean): Promise<T | null>
  readonly limited: boolean
}

function queueOf(gap: number, wait: (ms: number) => Promise<void>, stop?: AbortSignal): Queue {
  let active = 0
  let limited = false
  const waiting: (() => void)[] = []
  let turn = Promise.resolve()
  const acquire = (): Promise<void> => {
    if (active < IN_FLIGHT) {
      active += 1
      return Promise.resolve()
    }
    return new Promise((resolve) => waiting.push(resolve))
  }
  // The slot goes to the next request in line.
  const release = () => {
    const next = waiting.shift()
    if (next) next()
    else active -= 1
  }
  const spaced = () => {
    const mine = turn
    turn = mine.then(() => wait(gap))
    return mine
  }
  return {
    get limited() {
      return limited
    },
    async ask(request, limitedBy) {
      if (limited) return null
      await acquire()
      try {
        // A request after a rate limit does not wait for its turn.
        if (gap > 0 && !limited) await spaced()
        if (limited || stop?.aborted) return null
        const result = await request()
        if (limitedBy(result)) limited = true
        return result
      } finally {
        release()
      }
    },
  }
}

// The contracts that the explorers know: an address with code. An
// account with a delegate (EIP-7702) has no sources of its own.
export function contractsToLookUp(verification: Verification): Hex[] {
  return verification.contracts
    .filter(
      (contract) =>
        contract.helios.status === 'passed' &&
        contract.helios.value.code !== '0x' &&
        !delegateOf(contract.helios.value.code),
    )
    .map((contract) => contract.address)
}

// The contracts that get a profile: the ones the request names, with
// code. Not an implementation that the simulation found behind one.
export function contractsToProfile(verification: Verification): Hex[] {
  const withCode = new Set(contractsToLookUp(verification))
  return verification.contracts
    .filter(
      (contract) => contract.foundBy === 'request' && !contract.implementationOf && withCode.has(contract.address),
    )
    .map((contract) => contract.address)
}

// The addresses that the request names and that get no profile: an
// account, an account with a delegate, or an address whose code the
// chain gate did not read. The lists and GoPlus need no code.
export function accountsToCheck(verification: Verification): Hex[] {
  const profiled = new Set(contractsToProfile(verification))
  return verification.contracts
    .filter(
      (contract) => contract.foundBy === 'request' && !contract.implementationOf && !profiled.has(contract.address),
    )
    .map((contract) => contract.address)
}

// The code of an account as the chain gate read it. Null when the gate
// did not read it.
export function accountKind(
  verification: Verification,
  address: Hex,
  proof: boolean,
  rpc: string,
): Claimed<CodeKind> | null {
  const contract = verification.contracts.find((item) => item.address === address)
  if (contract?.helios.status !== 'passed') return null
  const { code } = contract.helios.value
  const value: CodeKind = code === '0x' ? 'account' : delegateOf(code) ? 'delegated' : 'contract'
  return { value, proof, source: chainSource(proof, rpc) }
}

// A stopped run sends no further request.
export function startContext(verification: Verification, deps: Deps, stop?: AbortSignal): ContextStore {
  const listeners = new Set<() => void>()
  const started = deps.now()
  // The log of the card shows these lines with the lines of the
  // verification, so they count on from its last line.
  const base = Math.max(0, ...verification.lines.map((line) => line.at))
  let snapshot: Context = { status: 'running', explorers: {}, profiles: {}, accounts: {}, lines: [] }
  const set = (change: Partial<Context>) => {
    snapshot = { ...snapshot, ...change }
    for (const listener of listeners) listener()
  }
  const logFor =
    (address: Hex, topic?: 'status'): Log =>
    (line) =>
      set({
        lines: [...snapshot.lines, { ...line, at: base + deps.now() - started, address, ...(topic ? { topic } : {}) }],
      })

  const run = async () => {
    const { chain } = verification
    // A request that failed before the chain gate has no contract with
    // code, so no lookup starts.
    const addresses = contractsToLookUp(verification)
    const accounts = accountsToCheck(verification)
    if (!chain || addresses.length + accounts.length === 0) return set({ status: 'done' })
    const hosts = explorersOf(chain)
    const settings = deps.settings()
    const { etherscanKey } = settings
    const queues: Record<Explorer, Queue> = {
      etherscan: queueOf(ETHERSCAN_GAP, deps.wait, stop),
      blockscout: queueOf(0, deps.wait, stop),
    }

    const rowsOf = (address: Hex): ExplorerRow[] => {
      const rows: ExplorerRow[] = []
      const add = (explorer: Explorer, host: string, link: string) =>
        rows.push({
          explorer,
          host,
          builtIn: host === (EXPLORER_HOSTS[chain.id] as ExplorerHosts | undefined)?.[explorer],
          link: linkable(link) ? link : null,
          state: { status: 'running' },
        })
      if (hosts.etherscan) add('etherscan', hosts.etherscan, etherscanLink(hosts.etherscan, address))
      if (hosts.blockscout && hosts.blockscoutApi) {
        add('blockscout', hosts.blockscout, blockscoutLink(hosts.blockscout, address))
      }
      return rows
    }
    set({ explorers: Object.fromEntries(addresses.map((address) => [address, rowsOf(address)])) })
    if (addresses.length > 0 && !hosts.etherscan && !hosts.blockscoutApi) {
      for (const address of addresses) {
        logFor(address, 'status')({ source: 'explorer', text: `no explorer covers chain ${chain.id}` })
      }
    }

    const report = (address: Hex, explorer: Explorer, result: ExplorerStatus) => {
      const rows = (snapshot.explorers[address] ?? []).map((row) =>
        row.explorer === explorer ? { ...row, state: { status: 'done', result } as const } : row,
      )
      set({ explorers: { ...snapshot.explorers, [address]: rows } })
    }

    // The source code status of each contract, from one explorer.
    const lookUp = (explorer: Explorer, api: string, ask: (address: Hex) => Promise<ExplorerStatus>) => {
      const apiHost = new URL(api).host
      return Promise.all(
        addresses.map(async (address) => {
          const log = logFor(address, 'status')
          const name = `${EXPLORER_NAMES[explorer]} · ${apiHost}`
          const key = `${explorer}:${api}:${chain.id}:${address}`
          const cached = deps.cache.get(key)
          let result: ExplorerStatus
          let note = ''
          if (cached) {
            result = cached
            note = ' · from this session'
          } else {
            const answer = await queues[explorer].ask(
              () => ask(address),
              (status) => status.kind === 'unknown' && status.limited === true,
            )
            if (answer === null) {
              if (stop?.aborted) return
              result = RATE_LIMITED
              note = ' · not asked'
            } else {
              result = answer
              if (definitive(result)) deps.cache.set(key, result)
            }
          }
          log({ source: 'explorer', text: `${name} · ${statusText(result)}${note}`, proof: false })
          report(address, explorer, result)
        }),
      )
    }

    const lookups: Promise<unknown>[] = []
    if (hosts.etherscan) {
      if (etherscanKey === '') {
        for (const address of addresses) {
          logFor(address, 'status')({ source: 'explorer', text: 'Etherscan · no API key · not asked' })
          report(address, 'etherscan', { kind: 'no key' })
        }
      } else {
        lookups.push(
          lookUp('etherscan', ETHERSCAN_API, (address) => etherscanSource(chain.id, address, etherscanKey, deps.fetch)),
        )
      }
    }
    if (hosts.blockscout && hosts.blockscoutApi) {
      const api = hosts.blockscoutApi
      lookups.push(lookUp('blockscout', api, (address) => blockscoutContract(api, address, deps.fetch)))
    }

    // The profiles: they share the queue of each explorer with the
    // lookups above.
    const blockscoutApi = hosts.blockscout ? hosts.blockscoutApi : null
    // The whole request waits for its turn, so its timer starts only
    // when it goes out.
    const askIn =
      (explorer: Explorer) =>
      <T>(request: () => Promise<Lookup<T>>): Promise<Lookup<T>> =>
        queues[explorer]
          .ask(request, (answer) => !answer.ok && answer.limited === true)
          .then((answer) => answer ?? { ok: false, reason: 'rate limited · not asked', limited: true })
    const askEtherscan = askIn('etherscan')
    const askBlockscout = askIn('blockscout')
    const access = deps.chainReaderFor(chain)
    const rpc = new URL(chain.executionRpc).host
    const block = verification.head?.block ?? null
    const proofText = (proof: boolean) => (proof ? 'proof checked' : `from ${rpc} · no proof`)
    const tokenLists = deps.tokenLists()

    // The lists of one address. An enabled list without data for the
    // chain, or a registry that failed, is in `missing`, not a list
    // that does not know the address.
    let states: Promise<ListState[]> | null = null
    let index: Promise<Lookup<RegistryIndex>> | null = null
    const listAnswer = async (target: Hex): Promise<ListAnswer> => {
      const [loaded, registry] = await Promise.all([
        (states ??= deps.lists()),
        (index ??= deps.registryIndex().then(
          (value): Lookup<RegistryIndex> => ({ ok: true, value }),
          (error: unknown): Lookup<RegistryIndex> => ({ ok: false, reason: errorText(error) }),
        )),
      ])
      return {
        hits: [
          ...hitsFor(loaded, chain.id, target),
          ...(registry.ok ? erc7730Hits(registry.value, chain.id, target) : []),
          ...tokenListHits(tokenLists, chain.id, target),
        ],
        missing: [
          ...missingFor(loaded, chain.id),
          ...(registry.ok ? [] : [{ list: ERC7730_NAME, reason: registry.reason }]),
          ...missingTokenLists(tokenLists),
        ],
        asked: [...askedFor(loaded, chain.id), ...(registry.ok ? [ERC7730_NAME] : []), ...askedTokenLists(tokenLists)],
      }
    }
    const readLists = async (target: Hex, log: Log, prefix: string): Promise<Lookup<ListAnswer>> => {
      let answer: Lookup<ListAnswer>
      try {
        answer = { ok: true, value: await listAnswer(target) }
      } catch (error) {
        answer = { ok: false, reason: errorText(error) }
      }
      if (!answer.ok) {
        log({ source: 'lists', text: `${prefix}lists · not read · ${answer.reason}` })
        return answer
      }
      const { hits, missing } = answer.value
      for (const hit of hits) {
        const text = `${prefix}${hit.kind === 'block' ? 'on a block list' : 'on an allow list'} · ${hit.list} · ${hit.label}`
        log({ source: 'lists', text, ok: hit.kind === 'block' ? false : undefined, proof: false })
      }
      const gaps = missing.length > 0 ? missingText(missing) : null
      if (hits.length === 0) {
        log({ source: 'lists', text: `${prefix}not on any list${gaps ? ` · ${gaps}` : ''}`, proof: false })
      } else if (gaps) log({ source: 'lists', text: `${prefix}${gaps}`, proof: false })
      return answer
    }

    // Undefined when the run stopped.
    const readGoPlus = async (target: Hex, log: Log): Promise<Lookup<GoPlusResult> | 'off' | undefined> => {
      if (!settings.goPlus) {
        log({ source: 'lists', text: 'GoPlus · off in the settings · not asked' })
        return 'off'
      }
      if (stop?.aborted) return undefined
      const answer = await addressSecurity(chain.id, target, deps.fetch)
      const text = answer.ok ? goPlusText(answer.value) : `unknown · ${answer.reason}`
      log({
        source: 'lists',
        text: `GoPlus · ${text}`,
        ok: answer.ok && answer.value.flags.length > 0 ? false : undefined,
        proof: false,
      })
      return answer
    }

    // The reads of one address that a card shows: its Blockscout claims,
    // its account state and its tokens. Each read logs on the card of
    // `log` and publishes the card when it ends.
    const readersFor = (log: Log, publish: () => void) => {
      // A read of the chain at the head block of the verification.
      const chainRead = async <T>(
        what: string,
        read: () => Promise<ChainValue<T>>,
        text: (value: T) => string,
      ): Promise<Lookup<ChainValue<T>>> => {
        if (block === null) return { ok: false, reason: 'the chain was not read' }
        if (stop?.aborted) return { ok: false, reason: 'stopped' }
        try {
          const value = await read()
          const note = value.note ? ` · ${value.note}` : ''
          log({
            source: chain.mode,
            text: `${what} · ${text(value.value)} · ${proofText(value.proof)}${note}`,
            proof: value.proof,
          })
          return { ok: true, value }
        } catch (error) {
          log({ source: chain.mode, text: `${what} · not read · ${errorText(error)}` })
          return { ok: false, reason: errorText(error) }
        }
      }

      const claimsOf = async (holder: HolderReads, target: Hex, prefix: string) => {
        if (!blockscoutApi) {
          const none: Lookup<never> = { ok: false, reason: 'no Blockscout instance covers this chain' }
          holder.blockscout = { address: none, tokens: none, transactions: none }
          log({ source: 'explorer', text: `${prefix}Blockscout · ${none.reason}` })
          return publish()
        }
        const key = `${blockscoutApi}:${chain.id}:${target}`
        const kept = deps.claims.get(key)
        const fresh = kept && deps.date() - kept.at < CLAIMS_TTL ? kept : undefined
        if (!fresh) deps.claims.delete(key)
        await readBlockscoutClaims(blockscoutApi, target, deps.fetch, log, {
          known: fresh?.parts ?? {},
          report: (part: ClaimPart, claim: Lookup<unknown>) => {
            ;(holder.blockscout as Record<ClaimPart, Lookup<unknown>>)[part] = claim
            // Only a part that answered is kept for the session.
            if (claim.ok && !isNotFound(claim)) {
              const entry = deps.claims.get(key)
              deps.claims.set(key, { at: entry?.at ?? deps.date(), parts: { ...entry?.parts, [part]: claim } })
            }
            publish()
          },
          prefix,
          ask: askBlockscout,
        })
      }

      const stateOf = async (holder: HolderReads, target: Hex, prefix: string) => {
        holder.account = await chainRead(
          `${prefix}eth_getProof ${short(target)}`,
          () => accountState(access, target, block!),
          (state) => `${amountText(state.balance, 18)} ETH · nonce ${state.nonce.toLocaleString('en-US')}`,
        )
        publish()
      }

      // The decimals and the amounts of the tokens that Blockscout names,
      // read from the chain.
      const amountsOf = async (holder: HolderReads, target: Hex, prefix: string) => {
        const page = holder.blockscout.tokens
        if (!page?.ok) return
        await Promise.all(
          page.value.tokens.slice(0, MAX_TOKENS).map(async (claim) => {
            const label = claim.symbol ?? short(claim.token)
            const same = (equal: boolean) => (equal ? 'as Blockscout says' : 'Blockscout says otherwise')
            const read = await chainRead(
              `${prefix}decimals ${label} ${short(claim.token)}`,
              () => tokenDecimals(access, claim.token, block!),
              (decimals) => `${decimals} · ${same(decimals === claim.decimals)}`,
            )
            holder.tokenDecimals[claim.token] = read
            const decimals = read.ok ? read.value.value : claim.decimals
            holder.tokenAmounts[claim.token] = await chainRead(
              `${prefix}balanceOf ${label} ${short(claim.token)}`,
              () => tokenBalance(access, claim.token, target, block!),
              (value) =>
                `${decimals === null ? String(value) : amountText(value, decimals)} · ${same(value === claim.value)}`,
            )
            publish()
          }),
        )
      }

      const transactionsFallback = async (holder: HolderReads, target: Hex, prefix: string) => {
        const page = holder.blockscout.transactions
        if (!page || page.ok || etherscanKey === '' || stop?.aborted) return
        const answer = await askEtherscan(() => etherscan.transactions(chain.id, target, etherscanKey, deps.fetch))
        holder.etherscanTransactions = answer
        const first = answer.ok ? answer.value.first : null
        const text = answer.ok
          ? first
            ? `transactions · ${pageText(answer.value)} · first ${dayText(first.time)} · ${short(first.hash)}`
            : 'transactions · none'
          : `transactions · not read · ${answer.reason}`
        log({ source: 'explorer', text: `${prefix}Etherscan · ${text}`, proof: false })
        publish()
      }

      // The activity of one address: the claims, then the tokens and the
      // fallback of the first transaction, with the account state.
      const activityOf = (holder: HolderReads, target: Hex, prefix: string) =>
        Promise.all([
          (async () => {
            await claimsOf(holder, target, prefix)
            await Promise.all([amountsOf(holder, target, prefix), transactionsFallback(holder, target, prefix)])
          })(),
          stateOf(holder, target, prefix),
        ])

      return { chainRead, claimsOf, amountsOf, transactionsFallback, stateOf, activityOf }
    }

    const profileOf = async (address: Hex) => {
      const log = logFor(address)
      const contract = verification.contracts.find((item) => item.address === address)
      const found = contract ? claimOf(contract.sourcify) : null
      const passed = contract?.sourcify.status === 'passed' ? contract.sourcify.value : null
      const reads: ProfileReads = {
        address,
        chainId: chain.id,
        now: deps.date(),
        rpc,
        explorer: blockscoutApi ? new URL(blockscoutApi).host : null,
        contract: emptyHolder(),
        sourcify: found
          ? { deployment: found.deployment ?? null, creation: passed?.creation ?? null, read: passed !== null }
          : null,
        deployer: emptyHolder(),
        tokenLists,
        done: false,
      }
      const publish = () => set({ profiles: { ...snapshot.profiles, [address]: buildProfile(reads) } })
      publish()

      const { chainRead, claimsOf, amountsOf, transactionsFallback, stateOf, activityOf } = readersFor(log, publish)

      const lists = async () => {
        reads.hits = await readLists(address, log, '')
        publish()
      }

      const goPlus = async () => {
        reads.goPlus = await readGoPlus(address, log)
        publish()
      }

      const deployer = async (target: Hex) => {
        const prefix = 'deployer · '
        const holder = reads.deployer
        await Promise.all([
          activityOf(holder, target, prefix),
          (async () => {
            holder.kind = await chainRead(
              `${prefix}eth_getCode ${short(target)}`,
              () => codeKind(access, target, block!),
              (kind) =>
                kind === 'contract' ? 'a contract' : kind === 'delegated' ? 'an account with a delegate' : 'an account',
            )
            publish()
          })(),
          (async () => {
            reads.deployer.hits = await readLists(target, log, prefix)
            publish()
          })(),
        ])
      }

      const deployment = async () => {
        await claimsOf(reads.contract, address, '')
        await Promise.all([
          amountsOf(reads.contract, address, ''),
          transactionsFallback(reads.contract, address, ''),
          (async () => {
            let claim = chooseCreation(reads)
            if (claim === null && etherscanKey !== '' && !stop?.aborted) {
              const answer = await askEtherscan(() => etherscan.creation(chain.id, address, etherscanKey, deps.fetch))
              reads.etherscanCreation = answer
              const text = answer.ok
                ? answer.value
                  ? `creation transaction ${short(answer.value.transactionHash)} · deployer ${short(answer.value.deployer)}`
                  : 'creation · not known'
                : `creation · not read · ${answer.reason}`
              log({ source: 'explorer', text: `Etherscan · ${text}`, proof: false })
              publish()
              claim = chooseCreation(reads)
            }
            if (claim === null || claim === 'pending') return
            const gateRead = claim.source === 'Sourcify' && reads.sourcify?.read
            if (!creationOf(reads) && !gateRead && !stop?.aborted) {
              reads.creationRead = await deps.creationReaderFor(chain, log)(address, claim.transactionHash)
              publish()
            }
            const at = deploymentBlock(reads)
            const time = at
              ? chainRead(
                  `block ${at.block.toLocaleString('en-US')}`,
                  () => blockTime(access, at.block),
                  (ms) => new Date(ms).toISOString().replace('.000Z', 'Z'),
                ).then((answer) => {
                  reads.blockTime = answer
                  publish()
                })
              : Promise.resolve()
            const who = creationOf(reads)?.deployer.toLowerCase() as Hex | undefined
            const target = who ?? claim.deployer
            await Promise.all([time, target ? deployer(target) : Promise.resolve()])
          })(),
        ])
      }

      try {
        await Promise.all([lists(), deployment(), stateOf(reads.contract, address, ''), goPlus()])
      } finally {
        // A read that did not end shows as unknown.
        reads.done = true
        publish()
      }
    }

    // The block lists and GoPlus also know accounts: most OFAC entries
    // have no code.
    const accountOf = async (address: Hex) => {
      const log = logFor(address)
      const reads: AccountReads = {
        address,
        chainId: chain.id,
        rpc,
        tokenLists,
        holder: emptyHolder(),
        kind: accountKind(verification, address, chain.mode === 'helios', rpc),
        done: false,
      }
      const publish = () => set({ accounts: { ...snapshot.accounts, [address]: buildAccount(reads) } })
      publish()
      const { activityOf } = readersFor(log, publish)
      try {
        await Promise.all([
          reads.kind ? activityOf(reads.holder, address, '') : Promise.resolve(),
          readLists(address, log, '').then((answer) => {
            reads.hits = answer
            publish()
          }),
          readGoPlus(address, log).then((answer) => {
            reads.goPlus = answer
            publish()
          }),
        ])
      } finally {
        reads.done = true
        publish()
      }
    }

    const profiles = contractsToProfile(verification).map((address) =>
      profileOf(address).catch((error: unknown) => {
        logFor(address)({ source: 'explorer', text: `profile · stopped · ${errorText(error)}` })
      }),
    )
    const checks = accounts.map((address) =>
      accountOf(address).catch((error: unknown) => {
        logFor(address)({ source: 'lists', text: `lists · stopped · ${errorText(error)}` })
      }),
    )
    await Promise.all([...lookups, ...profiles, ...checks])
    set({ status: 'done' })
  }
  run().catch(() => set({ status: 'done' }))

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
  }
}
