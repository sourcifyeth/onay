// The words of the review: the reason of a revert, and an amount of
// ether. No EVM in here, so the pages import it without one.

import type { Hex } from '../messages.ts'

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
  const bytes = Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16))
  return new TextDecoder().decode(bytes)
}

// An address or a hash, cut to its ends.
export const short = (hex: string) => `${hex.slice(0, 6)}…${hex.slice(-4)}`

// Wei as ether, with up to six decimals.
// A number with its noun: "1 slot", "2 slots".
export function count(n: number, what: string): string {
  return `${n.toLocaleString('en-US')} ${what}${n === 1 ? '' : 's'}`
}

export function formatEther(wei: bigint): string {
  if (wei > 0n && wei < 10n ** 12n) return '<0.000001'
  const whole = wei / 10n ** 18n
  const fraction = ((wei % 10n ** 18n) / 10n ** 12n).toString().padStart(6, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}
