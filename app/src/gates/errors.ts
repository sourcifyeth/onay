// The name of a custom error in a revert. A verified ABI of the run
// names it first. If none has it, the signature database of Sourcify
// can name it: a claim, because anyone can add a signature there. This
// module has no browser or Tauri calls, so the tests run it as it is.

import { ErrorFragment, Interface, type InterfaceAbi } from 'ethers'
import { render } from '../clear-signing/decode.ts'
import type { Hex } from '../messages.ts'

export const SIGNATURE_SOURCE = '4byte.sourcify.dev'
const LOOKUP_URL = 'https://api.4byte.sourcify.dev/signature-database/v1/lookup?function='
const TIMEOUT = 5000

// The selectors of Error(string) and Panic(uint256). Data that starts
// with one of them but does not decode is no custom error to look up.
const STANDARD = new Set(['0x08c379a0', '0x4e487b71'])

// The selector of a custom error in the return data of a revert. Null
// for an empty revert, a standard error, or data shorter than a
// selector.
export function customSelector(data: Hex | null): Hex | null {
  if (data === null || !/^0x[0-9a-fA-F]{8}/.test(data)) return null
  const selector = data.slice(0, 10).toLowerCase() as Hex
  return STANDARD.has(selector) ? null : selector
}

// An error with its arguments: "TooLittleReceived(amountOut: 5)". The
// arguments have names only if the fragment has them.
function errorText(fragment: ErrorFragment, data: Hex): string | null {
  let args
  try {
    args = new Interface([fragment]).decodeErrorResult(fragment, data)
  } catch {
    return null
  }
  const params = fragment.inputs.map((input, index) => {
    const value = render(input, args[index])
    return input.name ? `${input.name}: ${value}` : value
  })
  return `${fragment.name}(${params.join(', ')})`
}

// The error in an ABI that has the selector of the data and decodes it.
// Null if the ABI has no such error.
export function errorFromAbi(abi: unknown[], data: Hex): string | null {
  const selector = customSelector(data)
  if (!selector) return null
  let fragment
  try {
    fragment = new Interface(abi as InterfaceAbi).getError(selector)
  } catch {
    return null
  }
  return fragment ? errorText(fragment, data) : null
}

// The signatures of the database that decode the data. Two errors can
// share a selector, but a signature that does not decode the data is
// not the error.
export function errorsFromSignatures(signatures: string[], data: Hex): string[] {
  const found: string[] = []
  for (const signature of signatures) {
    let fragment
    try {
      fragment = ErrorFragment.from(`error ${signature}`)
    } catch {
      continue
    }
    if (fragment.selector !== data.slice(0, 10).toLowerCase()) continue
    const text = errorText(fragment, data)
    if (text !== null && !found.includes(text)) found.push(text)
  }
  return found
}

type LookupBody = {
  ok?: unknown
  result?: { function?: Record<string, { name?: unknown; filtered?: unknown; hasVerifiedContract?: unknown }[] | null> }
}

// The signatures of the answer for one selector. The database marks a
// signature that looks like spam as filtered: it is left out. A
// signature of a verified contract comes first.
export function parseLookup(body: unknown, selector: Hex): string[] {
  const entries = (body as LookupBody | null)?.result?.function?.[selector]
  if (!Array.isArray(entries)) return []
  const kept = entries.filter((entry) => typeof entry?.name === 'string' && entry.filtered !== true)
  const verified = kept.filter((entry) => entry.hasVerifiedContract === true)
  const others = kept.filter((entry) => entry.hasVerifiedContract !== true)
  return [...verified, ...others].map((entry) => entry.name as string)
}

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>

// The lookups of the session. A selector goes to the database once.
export function signatureCache(fetch: Fetch): (selector: Hex) => Promise<string[]> {
  const cache = new Map<Hex, Promise<string[]>>()
  return (selector) => {
    const key = selector.toLowerCase() as Hex
    let lookup = cache.get(key)
    if (!lookup) {
      lookup = (async () => {
        const response = await fetch(`${LOOKUP_URL}${key}`, { signal: AbortSignal.timeout(TIMEOUT) })
        if (!response.ok) throw new Error(`${SIGNATURE_SOURCE} answered ${response.status}`)
        return parseLookup(await response.json(), key)
      })()
      // A failed lookup can run again.
      lookup.catch(() => cache.delete(key))
      cache.set(key, lookup)
    }
    return lookup
  }
}
