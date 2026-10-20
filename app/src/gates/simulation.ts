// The simulation: the calls of the request, run in a local EVM on the
// state of the chain at the block of the request. Its one purpose is the
// call tree: every contract whose code runs, and in which context, so
// that the gates check each one and the implementation of a named
// contract counts as named. The EVM runs the calls alone, not in a
// block, so the gas it counts is not the gas of the chain. The state
// comes through `ChainRead`, so the tests run the gate on a fake chain.

import { createCustomCommon, Hardfork, Mainnet } from '@ethereumjs/common'
import { createEVM, type EVMResult, type Message } from '@ethereumjs/evm'
import { bytesToHex, createAddressFromString, hexToBytes } from '@ethereumjs/util'
import type { ChainConfig } from '../chains.ts'
import type { Hex } from '../messages.ts'
import type { Gate, Log } from './gate.ts'
import type { ChainCode, ChainRead } from './helios.ts'
import type { Call } from './request.ts'
import { ChainStateManager, type Reads } from './state.ts'

// State reads in Helios mode take a proof each. A large call tree takes a
// while.
const TIMEOUT = 180_000

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
}

export type Header = {
  number: number
  timestamp: number
  gasLimit: bigint
  baseFee: bigint | null
  coinbase: Hex
  prevRandao: Hex
  excessBlobGas: bigint | null
}

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
      // A read after the deadline, or one that hangs past it, ends the run.
      const guarded: ChainRead = (method, params) =>
        new Promise((resolve, reject) => {
          const fail = () => reject(new Error(`the simulation did not finish in ${timeout / 1000} s`))
          if (abort.signal.aborted) return fail()
          abort.signal.addEventListener('abort', fail, { once: true })
          read(method, params).then(resolve, reject)
        })
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
    evm.events.on('beforeMessage', before)
    evm.events.on('afterMessage', after)
    let result: EVMResult
    try {
      result = await evm.runCall({
        caller: createAddressFromString(call.from),
        to: createAddressFromString(call.to),
        data: hexToBytes(call.data),
        value: call.value,
        gasLimit: call.gas ?? header.gasLimit,
        block: evmBlock,
      })
    } finally {
      evm.events.off('beforeMessage', before)
      evm.events.off('afterMessage', after)
    }
    const error = errorOf(result)
    results.push({ call, frames, error })
    if (error) log({ source: 'evm', text: `reverted · ${error}`, ok: false })
    else log({ source: 'evm', text: `executed · ${count(frames.length, 'message')}`, ok: true })
  }
  const touched = touchedBy(results, state, block)
  const { accounts, slots } = state.reads
  log({
    source: 'evm',
    text: `state read · ${count(accounts, 'account')} · ${count(slots, 'storage slot')} · ${helios ? 'merkle proofs verified' : 'no proof'}`,
    ok: helios ? true : undefined,
    proof: helios,
  })
  log({ source: 'evm', text: `call tree · ${count(touched.length, 'contract')}`, ok: true })
  return { header, calls: results, touched, reads: state.reads }
}

// The rules of the newest Ethereum hardfork. A chain that lags behind
// runs the same contracts the same way, apart from the newest opcodes.
export function commonFor(chainId: number) {
  return createCustomCommon({ chainId }, Mainnet, { hardfork: Hardfork.Osaka, params: PARAMS })
}

// The two entries of `paramsBlock` in @ethereumjs/block that the blob
// fee needs, keyed by EIP. The common applies the blob forks on top.
const PARAMS = {
  4844: { blobGasPriceUpdateFraction: 3338477 },
  7691: { blobGasPriceUpdateFraction: 5007716 },
}

// The delegate of an EIP-7702 account, from its code. Null for any other
// code.
export function delegateOf(code: Hex): Hex | null {
  const delegate = /^0xef0100([0-9a-fA-F]{40})$/.exec(code)
  return delegate ? (`0x${delegate[1].toLowerCase()}` as Hex) : null
}

// The address of a create before the EVM gives it.
const UNKNOWN: Hex = '0x0000000000000000000000000000000000000000'

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

const PANIC_CODES: Record<number, string> = {
  0x01: 'assertion failed',
  0x11: 'arithmetic overflow',
  0x12: 'division by zero',
  0x21: 'invalid enum value',
  0x22: 'corrupted storage',
  0x31: 'pop on an empty array',
  0x32: 'index out of bounds',
  0x41: 'out of memory',
  0x51: 'uninitialized function',
}

// The return data of a revert, in words: the message of `Error(string)`,
// the code of `Panic(uint256)`, or the selector of a custom error. The
// data comes from the contract, so a shape that is not the one of the
// standard is a custom error, never an exception.
export function revertText(data: Hex): string {
  if (data === '0x') return 'reverted without a reason'
  const selector = data.slice(0, 10)
  const words = data.slice(10)
  const message = selector === '0x08c379a0' ? errorString(words) : null
  if (message !== null) return message
  if (selector === '0x4e487b71' && words.length === 64) {
    const code = Number(BigInt(`0x${words}`))
    return `panic 0x${code.toString(16).padStart(2, '0')}${PANIC_CODES[code] ? ` · ${PANIC_CODES[code]}` : ''}`
  }
  return `custom error ${selector}`
}

// One ABI-encoded string: its offset, its length, its bytes. Null if the
// words do not hold one.
function errorString(words: string): string | null {
  const word = (at: number): number | null => {
    const hex = words.slice(at, at + 64)
    if (hex.length !== 64) return null
    const value = BigInt(`0x${hex}`)
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null
  }
  const offset = word(0)
  if (offset === null || offset % 32 !== 0) return null
  const length = word(offset * 2)
  if (length === null) return null
  const text = words.slice(offset * 2 + 64, offset * 2 + 64 + length * 2)
  if (text.length !== length * 2) return null
  return new TextDecoder().decode(hexToBytes(`0x${text}`))
}

// The header of eth_getBlockByNumber. In RPC mode nothing else checks the
// fields, so each one the EVM reads is checked here.
export function parseHeader(value: unknown): Header {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw unexpected('a block')
  const block = value as Record<string, unknown>
  const number = Number(quantity(block.number, 'number'))
  const timestamp = Number(quantity(block.timestamp, 'timestamp'))
  if (!Number.isSafeInteger(number) || !Number.isSafeInteger(timestamp)) throw unexpected('a block number')
  return {
    number,
    timestamp,
    gasLimit: quantity(block.gasLimit, 'gas limit'),
    baseFee: block.baseFeePerGas == null ? null : quantity(block.baseFeePerGas, 'base fee'),
    coinbase: hex(block.miner, 40, 'miner'),
    prevRandao: block.mixHash == null ? `0x${'0'.repeat(64)}` : hex(block.mixHash, 64, 'mixHash'),
    excessBlobGas: block.excessBlobGas == null ? null : quantity(block.excessBlobGas, 'excess blob gas'),
  }
}

function blockFor(header: Header, blobFraction: bigint) {
  return {
    header: {
      number: BigInt(header.number),
      coinbase: createAddressFromString(header.coinbase),
      timestamp: BigInt(header.timestamp),
      difficulty: 0n,
      prevRandao: hexToBytes(header.prevRandao),
      gasLimit: header.gasLimit,
      baseFeePerGas: header.baseFee ?? undefined,
      getBlobGasPrice: () => blobGasPrice(header.excessBlobGas ?? 0n, blobFraction),
    },
  }
}

// EIP-4844, with the update fraction of the hardfork.
export function blobGasPrice(excessBlobGas: bigint, fraction: bigint): bigint {
  let i = 1n
  let output = 0n
  let accumulated = fraction
  while (accumulated > 0n) {
    output += accumulated
    accumulated = (accumulated * excessBlobGas) / (fraction * i)
    i++
  }
  return output / fraction
}

function unexpected(what: string): Error {
  return new Error(`eth_getBlockByNumber gave an unexpected ${what}`)
}

function quantity(value: unknown, what: string): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) throw unexpected(what)
  return BigInt(value)
}

function hex(value: unknown, digits: number, what: string): Hex {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-fA-F]{${digits}}$`).test(value)) throw unexpected(what)
  return value.toLowerCase() as Hex
}

// One frame in words, for the log and the review.
export function describe(frame: Frame): string {
  const known = frame.address !== UNKNOWN || frame.kind !== 'create'
  const parts: string[] = [known ? `${frame.kind} ${frame.address}` : frame.kind]
  if (frame.selector) parts.push(frame.selector)
  if (frame.value > 0n) parts.push(`${formatEther(frame.value)} ETH`)
  return parts.join(' · ')
}

// Wei as ether, with up to six decimals.
export function formatEther(wei: bigint): string {
  if (wei > 0n && wei < 10n ** 12n) return '<0.000001'
  const whole = wei / 10n ** 18n
  const fraction = ((wei % 10n ** 18n) / 10n ** 12n).toString().padStart(6, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

function count(n: number, what: string): string {
  return `${n.toLocaleString('en-US')} ${what}${n === 1 ? '' : 's'}`
}
