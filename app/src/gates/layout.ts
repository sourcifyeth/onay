// The names of changed storage slots, from the storage layout that the
// compiler gives for verified source code. Only a variable whose slot
// the layout fixes gets a name: a plain variable, a member of a struct,
// an element of an array of fixed size. The slot of a mapping entry or
// of a dynamic array is a hash, so it stays raw. This module has no EVM
// and no browser calls in it.

import type { Hex } from '../messages.ts'
import type { SlotChange } from './state.ts'

// One variable in a changed slot, with its values in words.
export type Variable = { name: string; type: string; before: string; after: string }

// A changed slot, and the variables that the layout puts in it. Empty:
// the layout names nothing there.
export type NamedSlot = SlotChange & { variables: Variable[] }

type TypeInfo = {
  encoding: string
  label: string
  numberOfBytes: string
  base?: string
  members?: Entry[]
}

type Entry = { label: string; slot: string; offset: number; type: string }

type Layout = { storage: Entry[]; types: Record<string, TypeInfo> }

// One variable that the layout fixes: where it is, and its type.
type Place = { name: string; slot: bigint; offset: number; size: number; type: string }

// A large array of fixed size would give a long list. Past this, the
// rest stays raw.
const MAX_PLACES = 4096

// The layout as solc gives it, or null for any other shape. Vyper gives
// another shape.
export function parseLayout(value: unknown): Layout | null {
  if (typeof value !== 'object' || value === null) return null
  const { storage, types } = value as { storage?: unknown; types?: unknown }
  if (!Array.isArray(storage) || (types !== null && typeof types !== 'object')) return null
  if (!storage.every(isEntry)) return null
  return { storage, types: (types ?? {}) as Record<string, TypeInfo> }
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.label === 'string' &&
    typeof entry.slot === 'string' &&
    /^\d+$/.test(entry.slot) &&
    typeof entry.offset === 'number' &&
    typeof entry.type === 'string'
  )
}

// Each variable of the layout with a fixed place.
function placesOf(layout: Layout): Place[] {
  const places: Place[] = []
  const add = (name: string, slot: bigint, offset: number, typeId: string) => {
    if (places.length >= MAX_PLACES) return
    const type = layout.types[typeId]
    if (!type || type.encoding !== 'inplace') return
    const size = Number(type.numberOfBytes)
    if (type.members) {
      for (const member of type.members) {
        if (!isEntry(member)) continue
        add(`${name}.${member.label}`, slot + BigInt(member.slot), member.offset, member.type)
      }
      return
    }
    if (type.base) {
      const base = layout.types[type.base]
      if (!base) return
      const item = Number(base.numberOfBytes)
      // Items of 16 bytes or less share a slot. A larger item starts a
      // slot of its own.
      const perSlot = item <= 16 ? Math.floor(32 / item) : 0
      const slots = Math.ceil(item / 32)
      // The size in bytes rounds up to whole slots, so the length comes
      // from the label: "uint8[5]".
      const length = /\[(\d+)\]$/.exec(type.label)
      if (!length) return
      const count = Number(length[1])
      for (let i = 0; i < count && places.length < MAX_PLACES; i++) {
        const at = perSlot ? slot + BigInt(Math.floor(i / perSlot)) : slot + BigInt(i * slots)
        add(`${name}[${i}]`, at, perSlot ? (i % perSlot) * item : 0, type.base)
      }
      return
    }
    if (size > 32) return
    places.push({ name, slot, offset, size, type: type.label })
  }
  for (const entry of layout.storage) add(entry.label, BigInt(entry.slot), entry.offset, entry.type)
  return places
}

// The bytes of one variable in a slot: `size` bytes, `offset` bytes from
// the right end.
function bitsOf(value: Hex, offset: number, size: number): bigint {
  const word = BigInt(value)
  return (word >> BigInt(offset * 8)) & ((1n << BigInt(size * 8)) - 1n)
}

// A value in words, by its type.
export function valueText(bits: bigint, type: string, size: number): string {
  if (type === 'bool') return bits === 0n ? 'false' : 'true'
  if (type === 'address' || type === 'address payable' || type.startsWith('contract ')) {
    return `0x${bits.toString(16).padStart(40, '0')}`
  }
  if (/^uint\d*$/.test(type) || type.startsWith('enum ')) return bits.toString()
  if (/^int\d*$/.test(type)) {
    const top = 1n << BigInt(size * 8 - 1)
    return (bits >= top ? bits - (top << 1n) : bits).toString()
  }
  return `0x${bits.toString(16).padStart(size * 2, '0')}`
}

// The changed slots of one contract, named with the layouts of the code
// that ran on its storage. A proxy keeps the variables of its
// implementation, so the caller gives that layout first. The first
// layout that names a slot wins.
export function nameSlots(layouts: unknown[], changes: SlotChange[]): NamedSlot[] {
  const placed = layouts.map(parseLayout).flatMap((layout) => (layout ? [placesOf(layout)] : []))
  return changes.map((change) => {
    const slot = BigInt(change.slot)
    for (const places of placed) {
      const here = places.filter((place) => place.slot === slot)
      if (here.length === 0) continue
      const variables = here.flatMap((place) => {
        const before = bitsOf(change.before, place.offset, place.size)
        const after = bitsOf(change.after, place.offset, place.size)
        if (before === after) return []
        const text = (bits: bigint) => valueText(bits, place.type, place.size)
        return [{ name: place.name, type: place.type, before: text(before), after: text(after) }]
      })
      if (variables.length > 0) return { ...change, variables }
    }
    return { ...change, variables: [] }
  })
}
