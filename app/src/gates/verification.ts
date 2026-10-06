// Runs the gates for each contract of a signing request, and keeps their log.
// React reads the result through `useSyncExternalStore`.

import type { Hex, SigningRequest } from '../messages.ts'
import { chainGate, chainReady, type ChainCode } from './chain.ts'
import { errorText, runGate, type GateState, type LogLine } from './gate.ts'

// TODO: take the chain from the request when the extension sends it.
const CHAIN_ID = 1

export type ContractChecks = { address: Hex; chain: GateState<ChainCode> }

export type TimedLine = LogLine & {
  // Milliseconds since the verification started.
  at: number
}

export type Verification = {
  chainId: number
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
    store = start(request, CHAIN_ID)
    stores.set(key, store)
  }
  return store
}

export function forgetVerification(request: SigningRequest) {
  stores.delete(requestKey(request))
}

function start(request: SigningRequest, chainId: number): VerificationStore {
  const addresses = contractsOf(request)
  const started = performance.now()
  const listeners = new Set<() => void>()
  let snapshot: Verification = {
    chainId,
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
    if (addresses.length === 0) {
      log({ source: 'helios', text: 'no contract to read', ok: true })
      return set({ status: 'passed' })
    }

    let block: number
    try {
      block = await chainReady(chainId, log)
    } catch (error) {
      const reason = errorText(error)
      log({ source: 'helios', text: reason, ok: false })
      addresses.forEach((_, index) => report(index, { status: 'failed', reason }))
      return set({ status: 'failed' })
    }

    // Contracts in parallel. The Sourcify gate will take the result of the
    // chain gate for the same contract.
    await Promise.all(
      addresses.map((address, index) =>
        runGate(chainGate, { chainId, address, block }, log, (state) => report(index, state)),
      ),
    )

    const passed = snapshot.checks.filter((check) => check.chain.status === 'passed').length
    const total = addresses.length
    const ok = passed === total
    log({ source: 'helios', text: `${passed}/${total} contracts read`, ok })
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
