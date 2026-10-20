// One verification: the gates for each contract of a signing request, and
// their log. The chain, the gates and the clock come in as parameters, so
// a test drives a whole run with fakes. React reads the result through
// `useSyncExternalStore`.

import type { ChainConfig } from '../chains.ts'
import type { Hex, SigningRequest } from '../messages.ts'
import type { ChainCode, Head, Target } from './helios.ts'
import { add, addImplementation, initial, MAX_CONTRACTS, pending, tally, update, type Contract } from './contracts.ts'
import { errorText, runGate, type Gate, type GateState, type Log, type LogLine } from './gate.ts'
import { delegateOf, reverted, type Simulation, type SimulationInput } from './simulation.ts'
import { callsOf, chainOf, contractsOf } from './request.ts'
import type { Verified } from './verify.ts'

export type TimedLine = LogLine & {
  // Milliseconds since the verification started.
  at: number
  // Set on the lines of the gates of one contract.
  address?: Hex
}

export type Status = 'running' | 'passed' | 'flagged' | 'failed'

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
  // 'passed' when each gate passed for each contract: the review can open.
  // 'flagged' when it passed with a warning: a contract that the
  // simulation found is not verified, or the simulation did not run the
  // calls through.
  status: Status
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
    log({ source: 'evm', text: `not simulated · ${reason}` })
    set({ simulation: { status: 'skipped', reason } })
  }
  // The end of a run without a contract to check. A transaction that was
  // not simulated leaves the call tree unchecked.
  const endWithoutContracts = () => {
    skipSimulation()
    if (!runs) return set({ status: 'passed' })
    log({ source: 'browser', text: `call tree not checked · ${requestCalls.reason}` })
    set({ status: 'flagged' })
  }

  const run = async () => {
    log({ source: 'browser', text: `request received · ${request.method} · from ${request.origin}` })
    // Before any gate runs: nothing is in flight that could report later.
    const fail = (reason: string) => {
      const failed = { status: 'failed', reason } as const
      set({
        contracts: snapshot.contracts.map((contract) => ({ ...contract, helios: failed, sourcify: failed })),
        simulation: failed,
        status: 'failed',
      })
    }
    if (resolved.chainId === null) {
      if (addresses.length === 0) return endWithoutContracts()
      skipSimulation()
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
      return endWithoutContracts()
    }
    if (contracts === null) {
      const reason = `more than ${MAX_CONTRACTS} contracts in the request`
      log({ source: 'browser', text: reason, ok: false })
      return fail(reason)
    }

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
      const counts = tally(snapshot.contracts)
      const total = snapshot.contracts.length
      const { simulation } = snapshot
      const failed = counts.failed > 0 || simulation.status === 'failed'
      const notes = []
      if (counts.flagged > 0) notes.push(`${counts.flagged} not verified on Sourcify`)
      if (simulation.status === 'passed' && reverted(simulation.value)) notes.push('the transaction reverts')
      if (simulation.status === 'skipped' && runs) notes.push(`call tree not checked · ${simulation.reason}`)
      const note = notes.map((text) => ` · ${text}`).join('')
      log({ source: chain.mode, text: `${counts.passed}/${total} contracts verified${note}`, ok: !failed })
      set({ status: failed ? 'failed' : notes.length > 0 ? 'flagged' : 'passed' })
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
        // The simulation finds the delegate.
        const reason = 'an account with a delegate (EIP-7702) · the delegate is checked'
        log({ source: 'sourcify', text: `${address} · ${reason}` })
        report(address, { sourcify: { status: 'skipped', reason } })
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
    // The addresses the request names, in lower case.
    const named = new Set(contracts.map((contract) => contract.address))
    const simulate = async () => {
      const { calls } = requestCalls
      if (calls === null) {
        skipSimulation()
        return end()
      }
      const simulation = await runGate(gates.simulation, { calls, block: head.block }, log, (state) => {
        if (state.status !== 'passed') return set({ simulation: state })
        let grown: Contract[] | null = snapshot.contracts
        for (const { address, contexts } of state.value.touched) {
          // Code that ran in the context of a named contract counts as named.
          const of = named.has(address) ? undefined : contexts.find((context) => named.has(context))
          grown = of === undefined ? add(grown, address, 'simulation') : addImplementation(grown, of, address)
          if (grown === null) break
        }
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
