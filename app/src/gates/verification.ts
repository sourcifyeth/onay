// Runs the gates for each contract of a signing request, and keeps their log.
// React reads the result through `useSyncExternalStore`.

import { chainById, type ChainConfig } from '../chains.ts'
import type { Hex, SigningRequest } from '../messages.ts'
import { chainGateFor, chainReady, type ChainCode } from './chain.ts'
import { errorText, runGate, type GateState, type LogLine } from './gate.ts'

export type ContractChecks = { address: Hex; chain: GateState<ChainCode> }

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
  checks: ContractChecks[]
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
  const resolved = chainOf(request)
  const chainId = resolved.chainId
  // Taken once: a change in the settings does not change a running request.
  const chain = chainId === null ? undefined : chainById(chainId)
  const started = performance.now()
  const listeners = new Set<() => void>()
  let snapshot: Verification = {
    chainId,
    mode: chain?.mode ?? null,
    checks: addresses.map((address) => ({ address, chain: { status: 'waiting' } })),
    lines: [],
    status: 'running',
  }

  const set = (change: Partial<Verification>) => {
    snapshot = { ...snapshot, ...change }
    for (const listener of listeners) listener()
  }
  const log = (line: LogLine) => set({ lines: [...snapshot.lines, { ...line, at: performance.now() - started }] })
  const report = (index: number, chain: GateState<ChainCode>) =>
    set({ checks: snapshot.checks.with(index, { ...snapshot.checks[index], chain }) })

  const run = async () => {
    log({ source: 'browser', text: `request received · ${request.method} · from ${request.origin}` })
    const fail = (reason: string) => {
      addresses.forEach((_, index) => report(index, { status: 'failed', reason }))
      set({ status: 'failed' })
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

    let block: number
    try {
      block = await chainReady(chain, log)
    } catch (error) {
      const reason = errorText(error)
      log({ source: chain.mode, text: reason, ok: false })
      return fail(reason)
    }

    // Contracts in parallel. The Sourcify gate will take the result of the
    // chain gate for the same contract.
    const chainGate = chainGateFor(chain)
    await Promise.all(
      addresses.map((address, index) => runGate(chainGate, { address, block }, log, (state) => report(index, state))),
    )

    const passed = snapshot.checks.filter((check) => check.chain.status === 'passed').length
    const total = addresses.length
    const ok = passed === total
    log({ source: chain.mode, text: `${passed}/${total} contracts read`, ok })
    set({ status: ok ? 'passed' : 'failed' })
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

// Where the chain of a request is known from.
export type RequestChain = { chainId: number; source: 'wallet' | 'request' } | { chainId: null; reason: string }

const CHAIN_SOURCE_TEXT = {
  wallet: 'reported by the wallet',
  request: 'named in the request',
}

// The chain of a request. The wallet's answer comes with eth_sendTransaction.
// The request itself names a chain in a transaction object, in the calls of
// wallet_sendCalls, or in the domain of typed data. Both are reports by the
// page, not verified. If the two disagree, the request is not checked.
export function chainOf(request: SigningRequest): RequestChain {
  const wallet = request.chainId
  const named = chainNamedIn(request)
  if (wallet !== null && named !== null && wallet !== named) {
    return { chainId: null, reason: `the request names chain ${named}, the wallet reported chain ${wallet}` }
  }
  if (wallet !== null) return { chainId: wallet, source: 'wallet' }
  if (named !== null) return { chainId: named, source: 'request' }
  return { chainId: null, reason: 'the request names no chain' }
}

function chainNamedIn({ method, params }: SigningRequest): number | null {
  const list = Array.isArray(params) ? params : []
  const first = list[0] as { chainId?: unknown } | undefined
  switch (method) {
    case 'eth_sendTransaction':
    case 'eth_signTransaction':
    case 'wallet_sendCalls':
      return parseChainId(first?.chainId)
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4':
      return parseChainId((parseTypedData(list[1]) as { domain?: { chainId?: unknown } } | null)?.domain?.chainId)
    default:
      return null
  }
}

// A chain id as a number, a decimal string, or a hex string.
export function parseChainId(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value.trim())) return null
  const chainId = Number(value)
  return Number.isSafeInteger(chainId) && chainId > 0 ? chainId : null
}

// The contracts that a request names. The params come from the page, so
// check each value. Messages (personal_sign, eth_sign) name no contract.
export function contractsOf({ method, params }: SigningRequest): Hex[] {
  const list = Array.isArray(params) ? params : []
  const first = list[0] as { to?: unknown; calls?: unknown } | undefined
  let found: unknown[] = []
  switch (method) {
    case 'eth_sendTransaction':
    case 'eth_signTransaction':
      found = [first?.to]
      break
    case 'wallet_sendCalls':
      found = Array.isArray(first?.calls) ? first.calls.map((call) => (call as { to?: unknown } | null)?.to) : []
      break
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4':
      found = [
        (parseTypedData(list[1]) as { domain?: { verifyingContract?: unknown } } | null)?.domain?.verifyingContract,
      ]
      break
  }
  const addresses = found.filter(isAddress).map((address) => address.toLowerCase() as Hex)
  return [...new Set(addresses)]
}

function parseTypedData(data: unknown): unknown {
  if (typeof data !== 'string') return data
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

function isAddress(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}
