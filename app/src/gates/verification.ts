// Runs the gates for each contract of a signing request, and keeps their log.
// React reads the result through `useSyncExternalStore`.

import { chainById, type ChainConfig } from '../chains.ts'
import type { Hex, SigningRequest } from '../messages.ts'
import { chainGateFor, chainReady, type ChainCode } from './chain.ts'
import { initial, MAX_CONTRACTS, passedCount, pending, withChain, type Contract } from './contracts.ts'
import { errorText, runGate, type GateState, type LogLine } from './gate.ts'
import { chainOf, contractsOf } from './request.ts'

export type TimedLine = LogLine & {
  // Milliseconds since the verification started.
  at: number
}

export type Verification = {
  // Null when the request names no chain. Messages have none.
  chainId: number | null
  // How the chain gate reads the chain. Null if the chain is not in the
  // settings.
  mode: ChainConfig['mode'] | null
  // The contracts that the request names, and the ones that the gates
  // find.
  contracts: Contract[]
  lines: TimedLine[]
  // 'passed' when each gate passed for each contract: the review can open.
  status: 'running' | 'passed' | 'failed'
}

export type VerificationStore = {
  subscribe(listener: () => void): () => void
  getSnapshot(): Verification
}

const stores = new Map<string, VerificationStore>()

export function requestKey(request: SigningRequest): string {
  return `${request.connection}:${request.id}`
}

// Starts the gates on the first call for a request. Later calls get the same
// store, so a render never starts them again.
export function verificationFor(request: SigningRequest): VerificationStore {
  const key = requestKey(request)
  let store = stores.get(key)
  if (!store) {
    store = start(request)
    stores.set(key, store)
  }
  return store
}

export function forgetVerification(request: SigningRequest) {
  stores.delete(requestKey(request))
}

function start(request: SigningRequest): VerificationStore {
  const addresses = contractsOf(request)
  const contracts = initial(addresses)
  const resolved = chainOf(request)
  const chainId = resolved.chainId
  // Taken once: a change in the settings does not change a running request.
  const chain = chainId === null ? undefined : chainById(chainId)
  const started = performance.now()
  const listeners = new Set<() => void>()
  let snapshot: Verification = {
    chainId,
    mode: chain?.mode ?? null,
    contracts: contracts ?? [],
    lines: [],
    status: 'running',
  }

  const set = (change: Partial<Verification>) => {
    snapshot = { ...snapshot, ...change }
    for (const listener of listeners) listener()
  }
  const log = (line: LogLine) => set({ lines: [...snapshot.lines, { ...line, at: performance.now() - started }] })
  const report = (address: Hex, chain: GateState<ChainCode>) =>
    set({ contracts: withChain(snapshot.contracts, address, chain) })

  const run = async () => {
    log({ source: 'browser', text: `request received · ${request.method} · from ${request.origin}` })
    const fail = (reason: string) => {
      set({
        contracts: snapshot.contracts.map((contract) => ({ ...contract, chain: { status: 'failed', reason } })),
        status: 'failed',
      })
    }
    if (resolved.chainId === null) {
      if (addresses.length === 0) return set({ status: 'passed' })
      log({ source: 'browser', text: resolved.reason, ok: false })
      return fail(resolved.reason)
    }
    log({ source: 'browser', text: `chain ${resolved.chainId} ${CHAIN_SOURCE_TEXT[resolved.source]}` })
    if (!chain) {
      const reason = `chain ${chainId} is not in the settings`
      log({ source: 'browser', text: reason, ok: false })
      return fail(reason)
    }
    if (addresses.length === 0) {
      log({ source: chain.mode, text: 'no contract to read', ok: true })
      return set({ status: 'passed' })
    }
    if (contracts === null) {
      const reason = `more than ${MAX_CONTRACTS} contracts in the request`
      log({ source: 'browser', text: reason, ok: false })
      return fail(reason)
    }

    let block: number
    try {
      block = await chainReady(chain, log)
    } catch (error) {
      const reason = errorText(error)
      log({ source: chain.mode, text: reason, ok: false })
      return fail(reason)
    }

    // The run ends when no contract waits for a gate. A gate that finds a
    // contract adds it to the list first, so the list can grow while the
    // run goes on.
    const end = () => {
      if (snapshot.status !== 'running') return
      const passed = passedCount(snapshot.contracts)
      const total = snapshot.contracts.length
      const ok = passed === total
      log({ source: chain.mode, text: `${passed}/${total} contracts read`, ok })
      set({ status: ok ? 'passed' : 'failed' })
    }
    // Contracts in parallel. The Sourcify gate will take the result of the
    // chain gate for the same contract.
    const chainGate = chainGateFor(chain)
    const check = async (address: Hex) => {
      await runGate(chainGate, { address, block }, log, (state) => report(address, state))
      if (!pending(snapshot.contracts)) end()
    }
    for (const { address } of contracts) void check(address)
  }
  void run()

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
  }
}

const CHAIN_SOURCE_TEXT = {
  wallet: 'reported by the wallet',
  request: 'named in the request',
}
