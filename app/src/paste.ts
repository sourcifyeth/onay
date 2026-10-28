// A request that the user pastes into the app. Each form becomes the
// method and params of a request from a page, so it goes through the
// same checks. No browser or Tauri calls.

import { toQuantity, Transaction } from 'ethers'
import type { AddRequestArgs } from './messages.ts'
import { chainNamedIn, isAddress, requestProblem, uncheckedPart } from './gates/request.ts'

// Same list as in extension/src/inpage.ts and extension/src/background.ts.
const SIGNING_METHODS = new Set([
  'eth_sendTransaction',
  'eth_signTransaction',
  'wallet_sendCalls',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'personal_sign',
  'eth_sign',
])

// No wallet reports the chain of a pasted request, so the params of a
// transaction must name it.
const TRANSACTION_METHODS = new Set(['eth_sendTransaction', 'eth_signTransaction', 'wallet_sendCalls'])

// Clear Signing needs the account that signs typed data. Typed data alone
// does not name it, so the paste must be a JSON-RPC request.
const NO_ACCOUNT =
  'the typed data names no signing account · paste it as {"method": "eth_signTypedData_v4", "params": ["0x<your account>", <the typed data>]}'

// The forms: a raw transaction in hex, or JSON (a transaction or a
// JSON-RPC request). The card refuses what the review would refuse, so
// the user gets the reason at once.
export function readPaste(text: string): AddRequestArgs {
  const request = parse(text)
  const problem = requestProblem(request)
  if (problem) throw new Error(`the request could not be read · ${problem}`)
  const unchecked = uncheckedPart(request)
  if (unchecked) throw new Error(unchecked)
  if (TRANSACTION_METHODS.has(request.method) && chainNamedIn(request) === null) {
    throw new Error('the transaction names no chainId')
  }
  return request
}

function parse(text: string): AddRequestArgs {
  // A terminal breaks long hex into lines.
  const hex = text.replace(/\s+/g, '')
  if (/^0x[0-9a-f]+$/i.test(hex)) return rawTransaction(hex)
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('the text is not a raw transaction or JSON')
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error('the JSON is not an object')
  const object = json as Record<string, unknown>
  if (typeof object.method === 'string') return readRpc(object.method, object.params)
  if (isTypedData(object)) throw new Error(NO_ACCOUNT)
  if (object.to === undefined && object.data === undefined && object.input === undefined) {
    throw new Error('the JSON is not a transaction or a JSON-RPC request')
  }
  return { method: 'eth_sendTransaction', params: [object], signed: false }
}

function readRpc(method: string, params: unknown): AddRequestArgs {
  if (!Array.isArray(params)) throw new Error('the params of a JSON-RPC request must be an array')
  // A signed transaction on its way to a node: the raw transaction form.
  if (method === 'eth_sendRawTransaction') {
    if (typeof params[0] !== 'string') throw new Error('eth_sendRawTransaction takes a raw transaction in hex')
    return rawTransaction(params[0])
  }
  if (!SIGNING_METHODS.has(method)) throw new Error(`${method} is not a signing method`)
  const typed = method === 'eth_signTypedData_v3' || method === 'eth_signTypedData_v4'
  if (typed && !isAddress(params[0])) throw new Error(NO_ACCOUNT)
  return { method, params, signed: false }
}

// Loose on purpose: a paste that looks like typed data gets the hint
// about the account. The review checks the shape of the types.
function isTypedData(typed: Record<string, unknown>): boolean {
  const isObject = (field: unknown) => typeof field === 'object' && field !== null && !Array.isArray(field)
  return (
    isObject(typed.types) && typeof typed.primaryType === 'string' && isObject(typed.domain) && isObject(typed.message)
  )
}

// A transaction as a wallet signs it, or signed already. The sender of a
// signed one comes from its signature.
function rawTransaction(raw: string): AddRequestArgs {
  let tx: Transaction
  try {
    tx = Transaction.from(raw)
  } catch {
    throw new Error('the hex is not a raw transaction · paste calldata as JSON with chainId, to and data')
  }
  // Blobs and EIP-7702 authorizations change what runs, and the
  // simulation does not model them.
  if (tx.type !== 0 && tx.type !== 1 && tx.type !== 2) throw new Error(`transaction type ${tx.type} is not supported`)
  return {
    method: 'eth_sendTransaction',
    params: [
      {
        ...(tx.from && { from: tx.from }),
        ...(tx.to && { to: tx.to }),
        data: tx.data,
        value: toQuantity(tx.value),
        gas: toQuantity(tx.gasLimit),
        // A legacy transaction without EIP-155 names no chain.
        ...(tx.chainId !== 0n && { chainId: toQuantity(tx.chainId) }),
      },
    ],
    signed: tx.isSigned(),
  }
}
