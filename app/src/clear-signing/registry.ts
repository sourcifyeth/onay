// The index of the ERC-7730 registry: which descriptor file describes
// which contract. The library fetches it from GitHub. One fetch serves
// the session, as the integration guide recommends. A fetch that failed
// is tried again on the next request.

import { fetchPrebuiltRegistryIndex, type RegistryIndex } from '@ethereum-sourcify/clear-signing'
import { withDeadline } from '../gates/gate.ts'

export const REGISTRY_URL = 'https://github.com/ethereum/clear-signing-erc7730-registry'

// The library fetches without a signal, so the deadline is here. A fetch
// that stalls would otherwise be the index of the whole session.
const TIMEOUT = 30_000

let index: Promise<RegistryIndex> | undefined

export function registryIndex(fetchIndex = fetchPrebuiltRegistryIndex, timeout = TIMEOUT): Promise<RegistryIndex> {
  index ??= withDeadline(
    fetchIndex,
    AbortSignal.timeout(timeout),
    `the registry index took longer than ${timeout / 1000} s`,
  )().catch((error: unknown) => {
    index = undefined
    throw error
  })
  return index
}

export const EMPTY_INDEX: RegistryIndex = { calldataIndex: {}, typedDataIndex: {} }
