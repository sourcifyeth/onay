// What a signing request says about itself: the chain and the contracts.
// The params come from the page, so each value is checked. This module has
// no browser or Tauri calls, so the tests run it as it is.

import type { Hex, SigningRequest } from '../messages.ts'

// Where the chain of a request is known from.
export type RequestChain = { chainId: number; source: 'wallet' | 'request' } | { chainId: null; reason: string }

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

// The chain that the params of a request name, if any.
export function chainNamedIn({ method, params }: Pick<SigningRequest, 'method' | 'params'>): number | null {
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

// A JSON-RPC quantity: a hex string such as "0x1a", as a number.
export function parseQuantity(value: unknown): number | null {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return null
  const quantity = Number(value)
  return Number.isSafeInteger(quantity) ? quantity : null
}

// A chain id as a number, a decimal string, or a hex string.
export function parseChainId(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value.trim())) return null
  const chainId = Number(value)
  return Number.isSafeInteger(chainId) && chainId > 0 ? chainId : null
}

// Why a request cannot be read: a field that is there but not in the
// form a wallet takes, for example a value without the 0x prefix. The
// wallet reads such a field its own way, so Onay must not guess what it
// means. Null if every field reads.
export function requestProblem({ method, params }: Pick<SigningRequest, 'method' | 'params'>): string | null {
  const list = Array.isArray(params) ? params : []
  switch (method) {
    case 'eth_sendTransaction':
    case 'eth_signTransaction':
      return callProblem(list[0], 'the transaction')
    case 'wallet_sendCalls': {
      const batch = list[0] as { from?: unknown; calls?: unknown } | undefined
      if (batch?.from != null && !isAddress(batch.from)) return 'the sender of the batch is not an address'
      if (!Array.isArray(batch?.calls)) return null
      for (const [index, call] of batch.calls.entries()) {
        const problem = callProblem(call, `call ${index + 1}`)
        if (problem) return problem
      }
      return null
    }
    default:
      return null
  }
}

function callProblem(value: unknown, what: string): string | null {
  if (typeof value !== 'object' || value === null) return `${what} is not an object`
  const call = value as Record<string, unknown>
  if (call.from != null && !isAddress(call.from)) return `the sender of ${what} is not an address`
  if (call.to != null && !isAddress(call.to)) return `the recipient of ${what} is not an address`
  for (const data of [call.data, call.input]) {
    if (data != null && !isData(data)) return `the data of ${what} is not hex bytes with the 0x prefix`
  }
  // A wallet may take either field. Geth refuses a transaction with both
  // when they differ, so this check does too.
  if (isData(call.data) && isData(call.input) && call.data.toLowerCase() !== call.input.toLowerCase()) {
    return `${what} has both data and input, and they differ`
  }
  if (call.value != null && !isQuantity(call.value)) {
    return `the value of ${what} is not a hex quantity with the 0x prefix`
  }
  if (call.gas != null && !isQuantity(call.gas)) return `the gas limit of ${what} is not a hex quantity`
  return null
}

function isData(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x([0-9a-fA-F]{2})*$/.test(value)
}

function isQuantity(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value)
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

// One call of a transaction, as the simulation runs it.
export type Call = {
  from: Hex
  to: Hex
  data: Hex
  value: bigint
  // Null if the request leaves the gas to the wallet.
  gas: bigint | null
}

// The calls of a request, or why there are none to run. A signature
// runs nothing. A transaction without a sender cannot run as the wallet
// would run it. `runs` says that the request still runs something on
// chain, so the call tree stays unchecked.
export type RequestCalls =
  | { calls: Call[]; reason?: undefined; runs?: undefined }
  | { calls: null; reason: string; runs: boolean }

export function callsOf({ method, params }: SigningRequest): RequestCalls {
  const list = Array.isArray(params) ? params : []
  const first = list[0] as { from?: unknown; calls?: unknown } | undefined
  let found: unknown[]
  switch (method) {
    case 'eth_sendTransaction':
    case 'eth_signTransaction':
      found = [first]
      break
    case 'wallet_sendCalls':
      found = Array.isArray(first?.calls) ? first.calls : []
      break
    default:
      return { calls: null, reason: 'a signature only · nothing runs on chain', runs: false }
  }
  if (!isAddress(first?.from)) return { calls: null, reason: 'the request names no sender', runs: true }
  const from = first.from.toLowerCase() as Hex
  const calls: Call[] = []
  for (const value of found) {
    const call = parseCall(from, value)
    if (call.calls === null) return call
    calls.push(...call.calls)
  }
  return { calls }
}

function parseCall(from: Hex, value: unknown): RequestCalls {
  const call = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const none = (reason: string): RequestCalls => ({ calls: null, reason, runs: true })
  if (!isAddress(call.to)) return none('contract creation · not simulated')
  const data = call.data ?? call.input ?? '0x'
  if (typeof data !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(data)) return none('the request has unexpected data')
  const amount = parseBigQuantity(call.value)
  if (amount === null) return none('the request has an unexpected value')
  const gas = call.gas === undefined || call.gas === null ? null : parseBigQuantity(call.gas)
  if (gas === null && call.gas != null) return none('the request has an unexpected gas limit')
  return { calls: [{ from, to: call.to.toLowerCase() as Hex, data: data as Hex, value: amount, gas }] }
}

// A JSON-RPC quantity of any size. Absent means zero.
function parseBigQuantity(value: unknown): bigint | null {
  if (value === undefined || value === null) return 0n
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return null
  return BigInt(value)
}

function parseTypedData(data: unknown): unknown {
  if (typeof data !== 'string') return data
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

export function isAddress(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}
