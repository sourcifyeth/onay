// The auditors whose attestations the user trusts (ERC-8176). A descriptor
// from the registry shows only after one of them attested it. The list
// starts empty: trust is the user's choice. The list is saved in the
// webview. The pure parts have no browser calls, so the tests run them.

import { getAddress } from 'ethers'
import type { Fetch } from '../gates/gate.ts'
import type { Hex } from '../messages.ts'

const STORAGE_KEY = 'onay.attesters'

// The registry keeps a profile for each auditor under this directory.
export const AUDITORS_URL = 'https://github.com/ethereum/clear-signing-erc7730-registry/tree/master/auditors'
const PROFILES_URL = 'https://raw.githubusercontent.com/ethereum/clear-signing-erc7730-registry/master/auditors'

export type Profile = { name: string; organization: string | null }

export function profileUrl(address: Hex): string {
  return `${PROFILES_URL}/eip155-1-${getAddress(address)}/profile.json`
}

// The profile of an auditor in the registry. Null if the registry has
// none: an address can attest without a profile. A profile is a name,
// not a check: the attestation is what counts.
export async function fetchProfile(address: Hex, fetch: Fetch): Promise<Profile | null> {
  const response = await fetch(profileUrl(address), { signal: AbortSignal.timeout(15_000) })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`the registry answered HTTP ${response.status}`)
  const body = (await response.json()) as { name?: unknown; organization?: unknown } | null
  if (typeof body?.name !== 'string') throw new Error('the profile has no name')
  return { name: body.name, organization: typeof body.organization === 'string' ? body.organization : null }
}

export function isAddress(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}

// The list with one entry for each address, as given, in lowercase.
export function parseAttesters(value: unknown): Hex[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<Hex>()
  for (const entry of value) {
    if (isAddress(entry)) seen.add(entry.toLowerCase() as Hex)
  }
  return [...seen]
}

// Adds an address. Null if it is not an address or is in the list.
export function withAttester(attesters: Hex[], value: string): Hex[] | null {
  const address = value.trim()
  if (!isAddress(address)) return null
  const key = address.toLowerCase() as Hex
  if (attesters.includes(key)) return null
  return [...attesters, key]
}

let attesters = load()
const listeners = new Set<() => void>()

export const attesterStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: () => attesters,
}

export function saveAttesters(next: Hex[]) {
  attesters = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // The change stays until the app closes.
  }
  for (const listener of listeners) listener()
}

function load(): Hex[] {
  try {
    return parseAttesters(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    return []
  }
}
