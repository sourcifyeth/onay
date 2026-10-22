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
