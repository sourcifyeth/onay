// The index of the ERC-7730 registry: which descriptor file describes
// which contract. The library fetches it from GitHub. One fetch serves
// the session, as the integration guide recommends. A fetch that failed
// is tried again on the next request.

import { fetchPrebuiltRegistryIndex, type RegistryIndex } from '@ethereum-sourcify/clear-signing'

export const REGISTRY_URL = 'https://github.com/ethereum/clear-signing-erc7730-registry'

let index: Promise<RegistryIndex> | undefined

export function registryIndex(): Promise<RegistryIndex> {
  index ??= fetchPrebuiltRegistryIndex().catch((error: unknown) => {
    index = undefined
    throw error
  })
  return index
}

export const EMPTY_INDEX: RegistryIndex = { calldataIndex: {}, typedDataIndex: {} }
