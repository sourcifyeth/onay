// Renders the request once the gates passed, and keeps the result with
// its log. React reads it through `useSyncExternalStore`, as with the
// verification.

import type { ChainInfoResult, FormatOptions, TrustedTokens } from '@ethereum-sourcify/clear-signing'
import { invoke } from '@tauri-apps/api/core'
import { chainById, type ChainConfig } from '../chains.ts'
import { errorText, type Log } from '../gates/gate.ts'
import { rpcRequest } from '../gates/helios.ts'
import { requestKey, type TimedLine, type Verification } from '../gates/verification.ts'
import type { ChainRequestArgs, Hex, SigningRequest } from '../messages.ts'
import { attesterStore } from './attesters.ts'
import { tokenStandard } from './decode.ts'
import { providerFor, type Reader } from './provider.ts'
import { EMPTY_INDEX, registryIndex } from './registry.ts'
import { inputOf, reasonOf, render, rendered, type DescriptorSource, type Rendering } from './render.ts'

export type ClearSigning = {
  status: 'running' | 'done'
  rendering: Rendering | null
  // Set if the index of the registry was not fetched.
  registryError: string | null
  // The trusted auditors at the time of the rendering.
  attesters: Hex[]
  lines: TimedLine[]
}

export type ClearSigningStore = {
  subscribe(listener: () => void): () => void
  getSnapshot(): ClearSigning
}

const stores = new Map<string, ClearSigningStore>()

// Starts the rendering on the first call for a request. Later calls get
// the same store.
export function clearSigningFor(request: SigningRequest, verification: Verification): ClearSigningStore {
  const key = requestKey(request)
  let store = stores.get(key)
  if (!store) {
    store = start(request, verification)
    stores.set(key, store)
  }
  return store
}

export function forgetClearSigning(request: SigningRequest) {
  stores.delete(requestKey(request))
}

// The chains that pay their fees in ether. A chain that is not here has
// no known native currency, so the library shows its amounts raw.
const ETHER_CHAINS = new Set([1, 11155111, 560048, 17000, 10, 8453, 42161, 59144, 480, 7777777, 130])

export function chainInfoOf(chain: ChainConfig | undefined): ChainInfoResult | null {
  if (!chain || !ETHER_CHAINS.has(chain.id)) return null
  return { name: chain.name, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } }
}

function readerFor(chain: ChainConfig): Reader {
  if (chain.mode === 'helios') {
    return {
      proof: true,
      request: (method, params) =>
        invoke<unknown>('chain_request', { chainId: chain.id, method, params } satisfies ChainRequestArgs).catch(
          (error) => {
            throw new Error(errorText(error))
          },
        ),
    }
  }
  return { proof: false, request: (method, params) => rpcRequest(chain.executionRpc, method, params) }
}

function start(request: SigningRequest, verification: Verification): ClearSigningStore {
  const started = performance.now()
  const listeners = new Set<() => void>()
  let snapshot: ClearSigning = {
    status: 'running',
    rendering: null,
    registryError: null,
    attesters: attesterStore.getSnapshot(),
    lines: [],
  }
  const set = (change: Partial<ClearSigning>) => {
    snapshot = { ...snapshot, ...change }
    for (const listener of listeners) listener()
  }
  const log: Log = (line) => set({ lines: [...snapshot.lines, { ...line, at: performance.now() - started }] })

  const run = async () => {
    const chainId = verification.chainId
    if (chainId === null || !verification.chain) return set({ status: 'done' })
    log({ source: 'erc7730', text: `rendering with the clear-signing library · ${request.method}` })

    let index = EMPTY_INDEX
    try {
      index = await registryIndex()
      const count = Object.keys(index.calldataIndex).length + Object.keys(index.typedDataIndex).length
      log({ source: 'erc7730', text: `registry index · ${count} contracts · from github.com`, proof: false })
    } catch (error) {
      const registryError = errorText(error)
      log({ source: 'erc7730', text: `registry index not fetched · ${registryError}`, ok: false })
      set({ registryError })
    }

    const { attesters } = snapshot
    if (attesters.length === 0) {
      log({ source: 'erc7730', text: 'no trusted auditor · descriptors from the registry show as previews' })
    } else {
      log({ source: 'erc7730', text: `trusted auditors · ${attesters.join(', ')}` })
    }

    // A contract whose verified ABI has the functions of a token
    // standard renders with the bundled template of the standard. Its
    // symbol and decimals are its own claims, read from the chain.
    const trustedTokens: TrustedTokens = { [chainId]: {} }
    const abis = new Map<Hex, unknown[]>()
    for (const contract of verification.contracts) {
      if (contract.sourcify.status !== 'passed') continue
      abis.set(contract.address, contract.sourcify.value.abi)
      const standard = tokenStandard(contract.sourcify.value.abi)
      if (standard) {
        trustedTokens[chainId][contract.address] = standard
        log({
          source: 'erc7730',
          text: `${contract.address} · verified ABI has the ${standard} functions`,
          proof: true,
        })
      }
    }

    const readers = (id: number) => {
      const chain = chainById(id)
      return chain ? readerFor(chain) : null
    }
    const provider = providerFor(chainId, readers, (id) => chainInfoOf(chainById(id)), log)
    const format: FormatOptions = {
      descriptorResolverOptions: {
        type: 'github',
        index,
        attestations: { trustedAttesters: attesters },
        trustedTokens,
      },
      externalDataProvider: provider,
    }
    const rendering = await render(inputOf(request), {
      chainId,
      format,
      index,
      trustedTokens,
      abis: (address) => abis.get(address) ?? null,
    })
    logOutcome(rendering, log)
    set({ status: 'done', rendering })
  }
  run().catch((error: unknown) => {
    log({ source: 'erc7730', text: `rendering failed · ${errorText(error)}`, ok: false })
    set({ status: 'done' })
  })

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
  }
}

function logOutcome(rendering: Rendering, log: Log) {
  const outcome = (
    display: Parameters<typeof rendered>[0],
    source: DescriptorSource | null,
    attested: boolean,
    what: string,
  ) => {
    if (!display) return
    if (rendered(display)) {
      const from = source?.kind === 'registry' ? source.path : 'the bundled token template'
      const note = attested ? '' : ' · preview · not attested by a trusted auditor'
      log({ source: 'erc7730', text: `${what} · rendered with ${from}${note}`, ok: attested })
    } else {
      const reason = reasonOf(display)
      log({ source: 'erc7730', text: `${what} · not rendered · ${reason?.message ?? 'no descriptor'}`, ok: false })
    }
  }
  switch (rendering.kind) {
    case 'transaction':
      outcome(rendering.call.display, rendering.call.source, rendering.call.attested, 'transaction')
      break
    case 'batch':
      rendering.calls.forEach((call, index) => outcome(call.display, call.source, call.attested, `call ${index + 1}`))
      break
    case 'typedData':
      outcome(rendering.display, rendering.source, rendering.attested, rendering.typed.primaryType)
      break
    case 'none':
      log({ source: 'erc7730', text: rendering.reason })
  }
}
