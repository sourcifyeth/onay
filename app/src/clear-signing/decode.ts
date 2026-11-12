// Plain decoding: the calldata read with the verified ABI (Application
// Binary Interface). It is the fallback when no descriptor renders the
// call, and part of the raw view next to one. This module has no browser
// or Tauri calls, so the tests run it as it is.

import { Interface, type InterfaceAbi, type ParamType, type Result } from 'ethers'
import type { Hex } from '../messages.ts'

export type Param = {
  name: string
  type: string
  // The value in words: numbers in decimal, bytes in hex, arrays and
  // tuples in brackets.
  value: string
}

export type Decoded = {
  selector: Hex
  name: string
  // With the names of the parameters: "transfer(address to, uint256 value)".
  signature: string
  params: Param[]
}

export function selectorOf(data: Hex): Hex | null {
  return /^0x[0-9a-fA-F]{8}/.test(data) ? (data.slice(0, 10).toLowerCase() as Hex) : null
}

// The calldata as the ABI words after the selector, 32 bytes each, in
// hex. The last word is shorter if the calldata is not a whole number
// of words. Null if the calldata has no selector.
export function rawWords(data: Hex): { selector: Hex; words: string[] } | null {
  const selector = selectorOf(data)
  if (!selector) return null
  const rest = data.slice(10).toLowerCase()
  const words: string[] = []
  for (let i = 0; i < rest.length; i += 64) words.push(rest.slice(i, i + 64))
  return { selector, words }
}

// Null if the ABI has no function with the selector of the calldata, or
// if the calldata does not decode with it.
export function decodeCalldata(abi: unknown[], data: Hex): Decoded | null {
  let parsed
  try {
    parsed = new Interface(abi as InterfaceAbi).parseTransaction({ data })
  } catch {
    return null
  }
  if (!parsed) return null
  const { fragment } = parsed
  const params = fragment.inputs.map((input, index) => ({
    name: input.name || `#${index}`,
    type: input.type,
    value: render(input, parsed.args[index]),
  }))
  return {
    selector: parsed.selector as Hex,
    name: fragment.name,
    signature: `${fragment.name}(${fragment.inputs.map((input) => input.format('full')).join(', ')})`,
    params,
  }
}

function render(param: ParamType, value: unknown): string {
  if (param.arrayChildren) {
    const items = (value as Result).toArray()
    return `[${items.map((item) => render(param.arrayChildren!, item)).join(', ')}]`
  }
  if (param.components) {
    const parts = param.components.map((component, index) => {
      const item = render(component, (value as Result)[index])
      return component.name ? `${component.name}: ${item}` : item
    })
    return `{ ${parts.join(', ')} }`
  }
  if (typeof value === 'string' && param.baseType === 'string') return JSON.stringify(value)
  return String(value)
}

// One event as an ABI decodes it.
export type DecodedEvent = { name: string; params: Param[] }

// The events of the token standards, for a contract whose source code is
// not verified. Such a contract can emit them with any meaning.
export const STANDARD_EVENTS = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)',
  'event ApprovalForAll(address indexed owner, address indexed operator, bool approved)',
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
  'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
  'event Deposit(address indexed dst, uint256 wad)',
  'event Withdrawal(address indexed src, uint256 wad)',
]

// Null if the ABI has no event with the first topic and the count of
// indexed values of the log, or if the log does not decode with it.
export function decodeEvent(abi: unknown[], log: { topics: Hex[]; data: Hex }): DecodedEvent | null {
  let parsed
  try {
    parsed = new Interface(abi as InterfaceAbi).parseLog({ topics: log.topics, data: log.data })
  } catch {
    return null
  }
  if (!parsed) return null
  const { fragment } = parsed
  if (fragment.inputs.filter((input) => input.indexed).length !== log.topics.length - 1) return null
  const params = fragment.inputs.map((input, index) => ({
    name: input.name || `#${index}`,
    type: input.type,
    value: render(input, parsed.args[index]),
  }))
  return { name: fragment.name, params }
}

// A log decoded with the events of the token standards. ERC-20 and
// ERC-721 give Transfer and Approval the same topic, so one ABI cannot
// hold both: each event is tried alone.
export function decodeStandardEvent(log: { topics: Hex[]; data: Hex }): DecodedEvent | null {
  for (const event of STANDARD_EVENTS) {
    const decoded = decodeEvent([event], log)
    if (decoded) return decoded
  }
  return null
}
