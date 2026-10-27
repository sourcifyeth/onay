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
      return parseChainId(signedDomain(parseTypedData(list[1])).chainId)
    default:
      return null
  }
}

// The domain fields that a signature of typed data covers: those that
// its EIP712Domain type lists. A wallet does not sign the other fields
// of the domain object. Without the type, MetaMask signs no field.
export function signedDomain(typed: unknown): Record<string, unknown> {
  const { types, domain } = (typeof typed === 'object' && typed !== null ? typed : {}) as {
    types?: { EIP712Domain?: unknown } | null
    domain?: unknown
  }
  const members = types?.EIP712Domain
  if (!Array.isArray(members) || typeof domain !== 'object' || domain === null) return {}
  const signed: Record<string, unknown> = {}
  for (const member of members) {
    const name = (member as { name?: unknown } | null)?.name
    if (typeof name === 'string' && Object.hasOwn(domain, name)) {
      signed[name] = (domain as Record<string, unknown>)[name]
    }
  }
  return signed
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
    case 'eth_signTransaction': {
      const authorizations = authorizationsOf({ params })
      return callProblem(list[0], 'the transaction') ?? (Array.isArray(authorizations) ? null : authorizations.problem)
    }
    case 'personal_sign':
    case 'eth_sign':
      return messageOf({ method, params })?.problem ?? null
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

// One entry of an EIP-7702 authorization list: the account sets its code
// to that of `address` on the chain. Chain 0 means every chain.
export type Authorization = { chainId: bigint; address: Hex; nonce: bigint }

// The authorization list of a transaction, empty if it has none, or why
// it does not read.
export function authorizationsOf({ params }: Pick<SigningRequest, 'params'>): Authorization[] | { problem: string } {
  const tx = (Array.isArray(params) ? params[0] : null) as { authorizationList?: unknown } | null
  const list = tx?.authorizationList
  if (list == null) return []
  if (!Array.isArray(list)) return { problem: 'the authorization list is not a list' }
  const authorizations: Authorization[] = []
  for (const [index, value] of list.entries()) {
    const entry = (value ?? {}) as { chainId?: unknown; address?: unknown; nonce?: unknown }
    if (!isAddress(entry.address) || !isQuantity(entry.chainId) || !isQuantity(entry.nonce)) {
      return { problem: `authorization ${index + 1} has no address, chain, and nonce in the form a wallet takes` }
    }
    authorizations.push({
      chainId: BigInt(entry.chainId),
      address: entry.address.toLowerCase() as Hex,
      nonce: BigInt(entry.nonce),
    })
  }
  return authorizations
}

// The message of personal_sign or eth_sign, and the account that signs.
export type Message = { bytes: Uint8Array; signer: Hex | null; problem?: undefined } | { problem: string }

// personal_sign takes [message, account], eth_sign [account, message].
// A message in hex stands for the bytes it spells, as ERC-8213 says.
// personal_sign takes any other string as UTF-8 text. Null for the
// other methods.
export function messageOf({ method, params }: Pick<SigningRequest, 'method' | 'params'>): Message | null {
  if (method !== 'personal_sign' && method !== 'eth_sign') return null
  const list = Array.isArray(params) ? params : []
  // Some wallets swap the two when only the first is an address.
  if (method === 'personal_sign' && isAddress(list[0]) && !isAddress(list[1])) {
    return { problem: 'the first parameter is an address, not the message, and wallets read this in different ways' }
  }
  const [message, signer] = method === 'personal_sign' ? [list[0], list[1]] : [list[1], list[0]]
  if (signer != null && !isAddress(signer)) return { problem: 'the signer is not an address' }
  if (typeof message !== 'string') return { problem: 'the message is not a string' }
  const account = signer == null ? null : (signer.toLowerCase() as Hex)
  if (isData(message)) {
    const bytes = Uint8Array.from(message.slice(2).match(/../g) ?? [], (byte) => parseInt(byte, 16))
    return { bytes, signer: account }
  }
  if (method === 'eth_sign' || /^0x/i.test(message))
    return { problem: 'the message is not hex bytes with the 0x prefix' }
  return { bytes: new TextEncoder().encode(message), signer: account }
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
      found = [signedDomain(parseTypedData(list[1])).verifyingContract]
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
