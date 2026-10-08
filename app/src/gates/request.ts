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
