// Renders the request once the gates passed, and keeps the result with
// its log. React reads it through `useSyncExternalStore`, as with the
// verification.

import type { ChainInfoResult, FormatOptions, TrustedTokens } from '@ethereum-sourcify/clear-signing'
import { invoke } from '@tauri-apps/api/core'
import { chainById, type ChainConfig } from '../chains.ts'
import { errorText, type Log } from '../gates/gate.ts'
import { rpcRequest } from '../gates/helios.ts'
import { requestKey, type TimedLine, type Verification } from '../gates/verification.ts'
import type { Verified } from '../gates/verify.ts'
import type { ChainRequestArgs, Hex, SigningRequest } from '../messages.ts'
import { attesterStore } from './attesters.ts'
import { providerFor, type Reader } from './provider.ts'
import { EMPTY_INDEX, registryIndex } from './registry.ts'
import { inputOf, reasonOf, render, rendered, type AbiSource, type DescriptorSource, type Rendering } from './render.ts'
import { listedOn, summary, tokenListStore, versionText } from './tokenLists.ts'

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
  // Stops the store from rendering again when the settings change.
  stop(): void
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
  const key = requestKey(request)
  stores.get(key)?.stop()
  stores.delete(key)
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

  // The rendering runs again when the auditors or the token lists
  // change. A run that a later one overtook changes nothing.
  let generation = 0
  const render_ = () => {
    const mine = ++generation
    const started = performance.now()
    snapshot = {
      ...snapshot,
      status: 'running',
      registryError: null,
      attesters: attesterStore.getSnapshot(),
      lines: [],
    }
    for (const listener of listeners) listener()
    const guarded = (change: Partial<ClearSigning>) => {
      if (mine === generation) set(change)
    }
    const log: Log = (line) => guarded({ lines: [...snapshot.lines, { ...line, at: performance.now() - started }] })
    run(guarded, log).catch((error: unknown) => {
      log({ source: 'erc7730', text: `rendering failed · ${errorText(error)}`, ok: false })
      guarded({ status: 'done' })
    })
  }

  const run = async (set: (change: Partial<ClearSigning>) => void, log: Log) => {
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

    // A contract that a token list of the user holds renders with the
    // bundled template of ERC-20. The list is the claim of its publisher,
    // not checked here. The symbol and decimals are the token's own
    // claims, read from the chain.
    const entries = tokenListStore.getSnapshot()
    const accepted = entries.filter((entry) => entry.list !== null)
    if (accepted.length === 0) {
      log({ source: 'erc7730', text: 'no token list · no call renders with the token template' })
    } else {
      const names = accepted.map((entry) => {
        const list = entry.list!
        return `${list.name} ${versionText(list.version)} (${summary(list).tokens} tokens)`
      })
      log({ source: 'erc7730', text: `token lists · ${names.join(' · ')}`, proof: false })
    }
    const listed = listedOn(entries, chainId)
    const trustedTokens: TrustedTokens = { [chainId]: {} }
    const verified = new Map<Hex, Verified>()
    for (const contract of verification.contracts) {
      if (contract.sourcify.status === 'passed') verified.set(contract.address, contract.sourcify.value)
      const lists = listed.get(contract.address)
      if (lists) {
        trustedTokens[chainId][contract.address] = 'erc20'
        log({
          source: 'erc7730',
          text: `${contract.address} · listed as an ERC-20 token by ${lists.join(', ')}`,
          proof: false,
        })
      }
    }

    // The contracts whose code ran in the context of a contract in the
    // simulation: the implementation of a proxy, the facet of a diamond,
    // or a library. Only the ones this transaction reached.
    const ranAs = (address: Hex): Hex[] => {
      const { simulation } = verification
      if (simulation.status !== 'passed') return []
      return simulation.value.touched
        .filter((touched) => touched.address !== address && touched.contexts.includes(address))
        .map((touched) => touched.address)
    }
    // The verified ABI of a contract, then those of the contracts that
    // ran as it. Sourcify's proxy detection, a claim, says whether it
    // names such a contract as the implementation.
    const abisOf = (address: Hex): AbiSource[] => {
      const own = verified.get(address)
      const result: AbiSource[] = own ? [{ address, name: own.claim.name, abi: own.abi, proxyType: null }] : []
      for (const delegate of ranAs(address)) {
        const value = verified.get(delegate)
        if (!value) continue
        const named = own?.claim.implementations.some((impl) => impl.address === delegate) ?? false
        result.push({
          address: delegate,
          name: value.claim.name,
          abi: value.abi,
          proxyType: named ? own!.claim.proxyType : null,
        })
      }
      return result
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
      listed,
      abis: (address) => abisOf(address),
      tokenName: (address) => provider.resolveToken!(chainId, address).then((token) => token?.name ?? null),
    })
    logOutcome(rendering, log)
    set({ status: 'done', rendering })
  }

  render_()
  const unsubscribe = [attesterStore.subscribe(render_), tokenListStore.subscribe(render_)]

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    stop: () => unsubscribe.forEach((stop) => stop()),
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
