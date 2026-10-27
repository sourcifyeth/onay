// One verification: the gates for each contract of a signing request, and
// their log. The chain, the gates and the clock come in as parameters, so
// a test drives a whole run with fakes. React reads the result through
// `useSyncExternalStore`.

import type { ChainConfig } from '../chains.ts'
import type { Hex, SigningRequest } from '../messages.ts'
import type { ChainCode, Head, Target } from './helios.ts'
import {
  addImplementation,
  grow,
  initial,
  MAX_CONTRACTS,
  pending,
  runVerdict,
  tally,
  update,
  type Contract,
  type Status,
} from './contracts.ts'
import { errorText, runGate, type Gate, type GateState, type Log, type LogLine } from './gate.ts'
import { delegateOf, type Simulation, type SimulationInput } from './simulation.ts'
import { callsOf, chainOf, contractsOf, requestProblem, uncheckedPart } from './request.ts'
import type { Verified } from './verify.ts'

export type TimedLine = LogLine & {
  // Milliseconds since the verification started.
  at: number
  // Set on the lines of the gates of one contract.
  address?: Hex
}

export type { Status }

export type Verification = {
  // Null when the request names no chain. Messages have none.
  chainId: number | null
  // How the gates read the chain. Null if the chain is not in the
  // settings.
  chain: ChainConfig | null
  // Set once the chain is ready.
  head: Head | null
  // The request runs something on chain, so a skipped simulation leaves
  // the call tree unchecked.
  runs: boolean
  // The contracts that the request names, and the ones that the
  // simulation finds.
  contracts: Contract[]
  // The calls of the request, run on the state of the chain. Skipped for
  // a request that runs nothing.
  simulation: GateState<Simulation>
  lines: TimedLine[]
  status: Status
  // Why the run stopped before it read the chain: Onay could not check
  // the request, and no gate ran. Null otherwise.
  stopped: string | null
}

export type VerificationStore = {
  subscribe(listener: () => void): () => void
  getSnapshot(): Verification
}

// The gates of one chain.
export type Gates = {
  helios: Gate<Target, ChainCode>
  // The gate of one contract. It logs the creation read on the log of
  // that contract.
  sourcify(log: Log): Gate<{ address: Hex; code: Hex }, Verified>
  simulation: Gate<SimulationInput, Simulation>
}

export type Deps = {
  chainById(id: number): ChainConfig | undefined
  chainReady(chain: ChainConfig, log: Log): Promise<Head>
  gatesFor(chain: ChainConfig): Gates
  now(): number
}

export function startVerification(request: SigningRequest, deps: Deps): VerificationStore {
  const addresses = contractsOf(request)
  const contracts = initial(addresses)
  // Too many: the page still shows the first ones, all failed.
  const shown = contracts ?? initial(addresses.slice(0, MAX_CONTRACTS)) ?? []
  const resolved = chainOf(request)
  const requestCalls = callsOf(request)
  const runs = requestCalls.calls !== null || requestCalls.runs
  const chainId = resolved.chainId
  // Taken once: a change in the settings does not change a running request.
  const chain = chainId === null ? undefined : deps.chainById(chainId)
  const started = deps.now()
  const listeners = new Set<() => void>()
  let snapshot: Verification = {
    chainId,
    chain: chain ?? null,
    head: null,
    runs,
    contracts: shown,
    simulation: { status: 'waiting' },
    lines: [],
    status: 'running',
    stopped: null,
  }

  const set = (change: Partial<Verification>) => {
    snapshot = { ...snapshot, ...change }
    for (const listener of listeners) listener()
  }
  const logFor =
    (address?: Hex): Log =>
    (line) =>
      set({ lines: [...snapshot.lines, { ...line, at: deps.now() - started, address }] })
  const log = logFor()
  const report = (address: Hex, change: Partial<Omit<Contract, 'address' | 'foundBy'>>) =>
    set({ contracts: update(snapshot.contracts, address, change) })
  // A request that runs nothing, or one that is not checked, has no
  // simulation to wait for.
  const skipSimulation = () => {
    const reason = requestCalls.reason ?? 'nothing to run'
    if (chain) log({ source: 'evm', text: `not simulated · ${reason}` })
    set({ simulation: { status: 'skipped', reason } })
  }
  // The end of a run without a contract to check. A transaction that was
  // not simulated leaves the call tree unchecked.
  const endWithoutContracts = () => {
    skipSimulation()
    if (!runs) return set({ status: 'passed' })
    log({ source: request.source, text: `call tree not checked · ${requestCalls.reason}` })
    set({ status: 'flagged' })
  }

  const run = async () => {
    const from = request.source === 'browser' ? ` · from ${request.origin}` : ''
    log({ source: request.source, text: `request received · ${request.method}${from}` })
    // Before any gate runs: the chain gate takes the reason, the other
    // gates did not start.
    const fail = (reason: string, change: Partial<Verification> = {}) => {
      const notRead = { status: 'skipped', reason: 'the chain was not read' } as const
      set({
        contracts: snapshot.contracts.map((contract) => ({
          ...contract,
          helios: { status: 'failed', reason },
          sourcify: notRead,
        })),
        simulation: notRead,
        status: 'failed',
        ...change,
      })
    }
    // A request that Onay cannot check: the run stops before it reads
    // the chain.
    const stop = (reason: string) => {
      log({ source: request.source, text: reason, ok: false })
      fail(reason, { stopped: reason })
    }
    // A request with a field that does not read is not checked at all:
    // the wallet reads it its own way, and a review of a guess would
    // confirm the wrong thing.
    const problem = requestProblem(request)
    if (problem) return stop(`the request could not be read · ${problem}`)
    const unchecked = uncheckedPart(request)
    if (unchecked) return stop(unchecked)
    if (resolved.chainId === null) {
      if (addresses.length === 0) return endWithoutContracts()
      return stop(resolved.reason)
    }
    log({ source: request.source, text: `chain ${resolved.chainId} ${CHAIN_SOURCE_TEXT[resolved.source]}` })
    if (!chain) return stop(`chain ${chainId} is not in the settings`)
    if (addresses.length === 0) {
      log({ source: chain.mode, text: 'no contract to read', ok: true })
      return endWithoutContracts()
    }
    if (contracts === null) return stop(`more than ${MAX_CONTRACTS} contracts in the request`)

    let head: Head
    try {
      head = await deps.chainReady(chain, log)
      set({ head })
    } catch (error) {
      const reason = errorText(error)
      log({ source: chain.mode, text: reason, ok: false })
      return fail(reason)
    }

    // The run ends when the simulation ended and no contract waits for a
    // gate. The simulation adds the contracts it finds to the list in the
    // same change as its result, so the list never looks complete too
    // early.
    const settled = () =>
      !pending(snapshot.contracts) &&
      snapshot.simulation.status !== 'waiting' &&
      snapshot.simulation.status !== 'running'
    const end = () => {
      if (snapshot.status !== 'running' || !settled()) return
      const { status, notes } = runVerdict(snapshot.contracts, snapshot.simulation, runs)
      const { passed } = tally(snapshot.contracts)
      const note = notes.map((text) => ` · ${text}`).join('')
      log({
        source: chain.mode,
        text: `${passed}/${snapshot.contracts.length} contracts verified${note}`,
        ok: status === 'passed' || status === 'flagged',
      })
      set({ status })
    }
    const gates = deps.gatesFor(chain)
    // One contract: the code from the chain, then the sources from
    // Sourcify, compiled and compared with the code and, if the chain
    // gate can read it, with the creation transaction. The simulation
    // read the code of the contracts it found already.
    const check = async (address: Hex, found?: ChainCode) => {
      const log = logFor(address)
      let code: ChainCode | null = found ?? null
      if (code) {
        const bytes = (code.code.length - 2) / 2
        log({
          source: chain.mode,
          text: `eth_getCode ${address} · ${bytes} bytes · read by the simulation`,
          ok: chain.mode === 'helios' ? true : undefined,
          proof: chain.mode === 'helios',
        })
        report(address, { helios: { status: 'passed', value: code } })
      } else {
        code = await runGate(gates.helios, { address, block: head.block }, log, (helios) => report(address, { helios }))
      }
      if (code === null) report(address, { sourcify: { status: 'failed', reason: 'the code was not read' } })
      else if (code.code === '0x') report(address, { sourcify: { status: 'skipped', reason: 'not a contract' } })
      else if (delegateOf(code.code)) {
        // The code of the delegate runs, in the context of this account.
        // The delegate of a named account counts as named, also when the
        // simulation does not run. The simulation finds the other ones.
        const delegate = delegateOf(code.code) as Hex
        const named = snapshot.contracts.find((contract) => contract.address === address)?.foundBy === 'request'
        const grown = named ? addImplementation(snapshot.contracts, address, delegate) : snapshot.contracts
        if (grown === null) {
          report(address, { sourcify: { status: 'failed', reason: `more than ${MAX_CONTRACTS} contracts` } })
        } else {
          const reason = 'an account with a delegate (EIP-7702) · the delegate is checked'
          log({ source: 'sourcify', text: `${address} · ${reason}` })
          set({ contracts: update(grown, address, { sourcify: { status: 'skipped', reason } }) })
          const found = snapshot.contracts.find((contract) => contract.address === delegate)
          if (found?.helios.status === 'waiting') void check(delegate, codeFound(delegate))
        }
      } else {
        await runGate(gates.sourcify(log), { address, code: code.code }, log, (sourcify) =>
          report(address, { sourcify }),
        )
      }
      end()
    }
    // The code of a contract, if the simulation read it.
    const codeFound = (address: Hex): ChainCode | undefined => {
      if (snapshot.simulation.status !== 'passed') return undefined
      const found = snapshot.simulation.value.touched.find((touched) => touched.address === address)
      return found && { address: found.address, block: found.block, code: found.code }
    }
    const simulate = async () => {
      const { calls } = requestCalls
      if (calls === null) {
        skipSimulation()
        return end()
      }
      const simulation = await runGate(gates.simulation, { calls, block: head.block }, log, (state) => {
        if (state.status !== 'passed') return set({ simulation: state })
        const grown = grow(snapshot.contracts, state.value.touched)
        if (grown === null) {
          const reason = `more than ${MAX_CONTRACTS} contracts in the call tree`
          log({ source: 'evm', text: reason, ok: false })
          return set({ simulation: { status: 'failed', reason } })
        }
        set({ contracts: grown, simulation: state })
      })
      // The named contracts run already: only the new ones start here.
      if (simulation) {
        for (const contract of snapshot.contracts) {
          if (contract.helios.status === 'waiting') void check(contract.address, codeFound(contract.address))
        }
      }
      end()
    }
    void simulate()
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
