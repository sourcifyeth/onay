// The simulation: the calls of the request, run in a local EVM on the
// state of the chain at the block of the request. It gives the call
// tree: every contract whose code runs, and in which context, so that
// the gates check each one and the implementation of a named contract
// counts as named. It also gives the effects: what the sender sends,
// receives and allows, from the state before and after the run. The EVM
// runs each call as a transaction would run it, apart from the fee: the
// gas of the chain comes from `gas.ts`. The state comes through
// `ChainRead`, so the tests run the gate on a fake chain.

import { createEVM, type EVM, type EVMResult, type Message } from '@ethereumjs/evm'
import { bytesToHex, createAddressFromString, hexToBytes, type Address } from '@ethereumjs/util'
import type { ChainConfig } from '../chains.ts'
import type { Hex } from '../messages.ts'
import { blockFor, commonFor, parseHeader, type Header } from './block.ts'
import { effectsOf, type Effects, type EventLog } from './effects.ts'
import { chargedGas, gasPriceOf, intrinsicGas, TX_GAS_CAP } from './gas.ts'
import { errorText, withDeadline, type Gate, type Log } from './gate.ts'
import type { ChainCode, ChainRead } from './helios.ts'
import type { Call } from './request.ts'
import { ChainStateManager, type Reads, type StateDiff } from './state.ts'
import { formatEther, revertText } from './words.ts'

// State reads in Helios mode take a proof each. A large call tree takes a
// while.
const TIMEOUT = 180_000

// The gas of one probe. A balanceOf takes a few thousand.
const PROBE_GAS = 1_000_000n

export type FrameKind = 'call' | 'staticcall' | 'delegatecall' | 'create'

// One message of the EVM: the call of the request, or a call that a
// contract made.
export type Frame = {
  depth: number
  kind: FrameKind
  // The address whose code ran. For a create, the new contract.
  address: Hex
  // The account whose storage and balance the code acted on. A call, a
  // staticcall and a create run in their own address. A delegatecall
  // runs in the context of its caller.
  context: Hex
  // The first four bytes of the data: the function selector.
  selector: Hex | null
  value: bigint
  // Why the message failed. Null if it did not.
  error: string | null
}

export type SimulatedCall = {
  call: Call
  frames: Frame[]
  // The error of the first frame: the call as a whole failed.
  error: string | null
  // The events, in order. A call that failed has none.
  logs: EventLog[]
  // The gas that the chain charges for the call.
  gas: bigint
}

// The fee of all calls: their gas times the price of one unit.
export type Fee = { gas: bigint; price: bigint; fromRequest: boolean }

export type EffectsState =
  | { status: 'passed'; value: Effects }
  // A call reverted, so nothing changes.
  | { status: 'skipped'; reason: string }
  // A probe could not read the chain. The call tree still holds.
  | { status: 'failed'; reason: string }

// A contract whose code ran, with the distinct contexts it ran in, in
// the order of the first run. The delegate of an EIP-7702 account ran in
// the context of that account.
export type Touched = ChainCode & { contexts: Hex[] }

export type Simulation = {
  header: Header
  calls: SimulatedCall[]
  // Every contract whose code ran, in the order of the first run, with
  // the code the chain gave and its contexts. Precompiles and contracts
  // created by the calls are not in it: they have no sources to check.
  touched: Touched[]
  reads: Reads
  // Each balance, nonce and storage slot that the calls changed.
  diff: StateDiff
  fee: Fee
  effects: EffectsState
}

// True if a call of the run reverted.
export function reverted({ calls }: Simulation): boolean {
  return calls.some((call) => call.error !== null)
}

export type SimulationInput = { calls: Call[]; block: number }

export function simulationGateFor(
  chain: ChainConfig,
  read: ChainRead,
  timeout = TIMEOUT,
): Gate<SimulationInput, Simulation> {
  return {
    source: 'evm',
    async run(input, log) {
      const abort = new AbortController()
      const timer = setTimeout(() => abort.abort(), timeout)
      const guarded = withDeadline(read, abort.signal, `the simulation did not finish in ${timeout / 1000} s`)
      try {
        return await simulate(chain, guarded, input, log)
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

async function simulate(chain: ChainConfig, read: ChainRead, { calls, block }: SimulationInput, log: Log) {
  const helios = chain.mode === 'helios'
  const header = parseHeader(await read('eth_getBlockByNumber', [`0x${block.toString(16)}`, false]))
  // In RPC mode nothing else checks that the endpoint gave this block.
  if (header.number !== block) throw new Error(`eth_getBlockByNumber gave block ${header.number}, not ${block}`)
  log({
    source: 'evm',
    text: `block ${header.number.toLocaleString('en-US')} · ${helios ? 'header verified' : 'header without proof'}`,
    ok: helios ? true : undefined,
    proof: helios,
  })
  const state = new ChainStateManager(read, block)
  const common = commonFor(chain.id)
  const evm = await createEVM({ common, stateManager: state })
  const evmBlock = blockFor(header, common.param('blobGasPriceUpdateFraction'))
  // One price for all calls. A batch takes the fees of its first call.
  const price = gasPriceOf(calls[0]?.fees, header.baseFee)
  const results: SimulatedCall[] = []
  for (const [index, call] of calls.entries()) {
    if (calls.length > 1) log({ source: 'evm', text: `call ${index + 1} of ${calls.length}` })
    const frames: Frame[] = []
    // The messages that run now, deepest last. Null for a precompile.
    const open: (Frame | null)[] = []
    const before = (message: Message) => {
      const kind = kindOf(message)
      if (kind !== 'create' && evm.getPrecompile(message.codeAddress) !== undefined) {
        open.push(null)
        return
      }
      const frame: Frame = {
        depth: message.depth,
        kind,
        address: kind === 'create' ? UNKNOWN : (message.codeAddress.toString() as Hex),
        context: message.to === undefined ? UNKNOWN : (message.to.toString() as Hex),
        selector: message.data.length >= 4 ? bytesToHex(message.data.slice(0, 4)) : null,
        // A delegatecall keeps the value of its caller. It moves none.
        value: kind === 'delegatecall' ? 0n : message.value,
        error: null,
      }
      frames.push(frame)
      open.push(frame)
      log({ source: 'evm', text: `${'  '.repeat(frame.depth)}${describe(frame)}` })
    }
    const after = (result: EVMResult) => {
      const frame = open.pop()
      if (!frame) return
      if (frame.kind === 'create' && result.createdAddress) {
        frame.address = result.createdAddress.toString() as Hex
        frame.context = frame.address
      }
      frame.error = errorOf(result)
    }
    const caller = createAddressFromString(call.from)
    const to = createAddressFromString(call.to)
    // A transaction starts with these warm (EIP-2929, EIP-3651), so the
    // gas of the run is the gas of the chain.
    warm(evm, [caller, to, evmBlock.header.coinbase])
    const intrinsic = intrinsicGas(call.data)
    const limit = call.gas ?? (header.gasLimit < TX_GAS_CAP ? header.gasLimit : TX_GAS_CAP)
    if (limit < intrinsic) throw new Error(`the gas limit ${limit} is below the intrinsic gas ${intrinsic}`)
    evm.events.on('beforeMessage', before)
    evm.events.on('afterMessage', after)
    let result: EVMResult
    try {
      result = await evm.runCall({
        caller,
        origin: caller,
        to,
        data: hexToBytes(call.data),
        value: call.value,
        gasLimit: limit - intrinsic,
        gasPrice: price.price,
        block: evmBlock,
      })
    } finally {
      evm.events.off('beforeMessage', before)
      evm.events.off('afterMessage', after)
    }
    // The end of a transaction: empty accounts go (EIP-161), and the warm
    // addresses cool down for the next call.
    await evm.journal.cleanup()
    const error = errorOf(result)
    const { execResult } = result
    const logs = error ? [] : (execResult.logs ?? []).map(logOf)
    const gas = chargedGas(call.data, execResult.executionGasUsed, execResult.gasRefund ?? 0n)
    results.push({ call, frames, error, logs, gas })
    if (error) log({ source: 'evm', text: `reverted · ${error}`, ok: false })
    else
      log({
        source: 'evm',
        text: `executed · ${count(frames.length, 'message')} · ${count(logs.length, 'event')}`,
        ok: true,
      })
  }
  const touched = touchedBy(results, state, block)
  const diff = await state.diff()
  const fee: Fee = { gas: results.reduce((sum, result) => sum + result.gas, 0n), ...price }
  const effects = await effectsFor(results, diff, state, evm, evmBlock, log)
  const { accounts, slots } = state.reads
  log({
    source: 'evm',
    text: `state read · ${count(accounts, 'account')} · ${count(slots, 'storage slot')} · ${helios ? 'merkle proofs verified' : 'no proof'}`,
    ok: helios ? true : undefined,
    proof: helios,
  })
  log({ source: 'evm', text: `call tree · ${count(touched.length, 'contract')}`, ok: true })
  return { header, calls: results, touched, reads: state.reads, diff, fee, effects }
}

// The effects of the run: probes on the state before it, in an EVM of
// its own, and on the state after it, in the EVM of the run.
async function effectsFor(
  results: SimulatedCall[],
  diff: StateDiff,
  state: ChainStateManager,
  evm: EVM,
  block: ReturnType<typeof blockFor>,
  log: Log,
): Promise<EffectsState> {
  if (results.some((result) => result.error !== null)) return { status: 'skipped', reason: 'the transaction reverts' }
  const you = results[0]?.call.from
  if (!you) return { status: 'skipped', reason: 'nothing ran' }
  try {
    const previous = await createEVM({ common: evm.common, stateManager: state.before() })
    const caller = createAddressFromString(you)
    const probe = async (to: Hex, data: Hex, when: 'before' | 'after') => {
      const vm = when === 'before' ? previous : evm
      const { execResult } = await vm.runCall({
        caller,
        to: createAddressFromString(to),
        data: hexToBytes(data),
        gasLimit: PROBE_GAS,
        isStatic: true,
        skipNonceIncrement: true,
        block,
      })
      return execResult.exceptionError ? null : (bytesToHex(execResult.returnValue) as Hex)
    }
    const calls = results.map((result) => result.call)
    const value = await effectsOf({ you, calls, logs: results.flatMap((result) => result.logs), diff }, probe)
    const parts = [count(value.assets.length, 'asset change'), count(value.permissions.length, 'allowance')]
    if (value.warnings.length > 0) parts.push(count(value.warnings.length, 'event without a balance change'))
    log({ source: 'evm', text: `effects · ${parts.join(' · ')} · ${count(value.probes, 'probe')}`, ok: true })
    return { status: 'passed', value }
  } catch (error) {
    const reason = errorText(error)
    log({ source: 'evm', text: `effects not read · ${reason}`, ok: false })
    return { status: 'failed', reason }
  }
}

function warm(evm: EVM, addresses: Address[]) {
  for (const address of addresses) evm.journal.addAlwaysWarmAddress(address.toString())
  for (const address of evm.precompiles.keys()) evm.journal.addAlwaysWarmAddress(address)
}

function logOf([address, topics, data]: [Uint8Array, Uint8Array[], Uint8Array]): EventLog {
  return {
    address: bytesToHex(address) as Hex,
    topics: topics.map((value) => bytesToHex(value) as Hex),
    data: bytesToHex(data) as Hex,
  }
}

// The delegate of an EIP-7702 account, from its code. Null for any other
// code.
export function delegateOf(code: Hex): Hex | null {
  const delegate = /^0xef0100([0-9a-fA-F]{40})$/.exec(code)
  return delegate ? (`0x${delegate[1].toLowerCase()}` as Hex) : null
}

// The address of a create before the EVM gives it, or when it failed.
export const UNKNOWN: Hex = '0x0000000000000000000000000000000000000000'

// A callcode runs the code of another address in the context of the
// caller too, so it counts as a delegatecall.
function kindOf(message: Message): FrameKind {
  if (message.to === undefined) return 'create'
  if (message.delegatecall || !message.codeAddress.equals(message.to)) return 'delegatecall'
  if (message.isStatic) return 'staticcall'
  return 'call'
}

// The contracts whose code ran, each once, with the code the chain gave
// and the contexts of their frames.
function touchedBy(results: SimulatedCall[], state: ChainStateManager, block: number): Touched[] {
  const touched: Touched[] = []
  const known = new Map<Hex, Touched>()
  const touch = (address: Hex, context: Hex) => {
    const code = state.codes.get(address)
    if (code === undefined || code === '0x') return
    let entry = known.get(address)
    if (!entry) {
      entry = { address, block, code, contexts: [] }
      known.set(address, entry)
      touched.push(entry)
    }
    if (!entry.contexts.includes(context)) entry.contexts.push(context)
    // An EIP-7702 account runs the code of its delegate in its own
    // context. The EVM follows one delegation, never a chain of them.
    const delegate = delegateOf(code)
    if (delegate && !delegateOf(state.codes.get(delegate) ?? '0x')) touch(delegate, context)
  }
  for (const { frames } of results) {
    for (const frame of frames) if (frame.kind !== 'create') touch(frame.address, frame.context)
  }
  return touched
}

function errorOf({ execResult }: EVMResult): string | null {
  const error = execResult.exceptionError
  if (!error) return null
  if (error.error !== 'revert') return error.error
  return revertText(bytesToHex(execResult.returnValue))
}

// One frame in words, for the log and the review.
export function describe(frame: Frame): string {
  const known = frame.address !== UNKNOWN || frame.kind !== 'create'
  const parts: string[] = [known ? `${frame.kind} ${frame.address}` : frame.kind]
  if (frame.selector) parts.push(frame.selector)
  if (frame.value > 0n) parts.push(`${formatEther(frame.value)} ETH`)
  return parts.join(' · ')
}

function count(n: number, what: string): string {
  return `${n.toLocaleString('en-US')} ${what}${n === 1 ? '' : 's'}`
}
