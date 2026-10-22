// What a signing request asks to sign, rendered: with an ERC-7730
// descriptor through the clear-signing library where the registry has
// one, and with the verified ABI (Application Binary Interface) in any
// case. A descriptor that no trusted auditor attested renders as a
// preview, marked as such. The params come from the page, so each value
// is checked. This module has no browser or Tauri calls, so the tests
// run it as it is.

import {
  format,
  formatEip5792Batch,
  formatTypedData,
  type DisplayModel,
  type FormatOptions,
  type RegistryIndex,
  type TypedData,
  type Warning,
} from '@ethereum-sourcify/clear-signing'
import { formatUnits } from 'ethers'
import type { Hex, SigningRequest } from '../messages.ts'
import { decodeCalldata, type Decoded } from './decode.ts'

// Where the descriptor of a rendered call came from: a file in the
// registry, or the bundled template of a token standard, with the names
// of the token lists that hold the address and the name the token gives
// itself on the chain.
export type DescriptorSource =
  | { kind: 'registry'; path: string }
  | { kind: 'template'; lists: string[]; name: string | null }

export type Call = {
  to: Hex | null
  data: Hex
  // Null if the request gave none, or one that is not a quantity.
  value: bigint | null
  // The result of the library. Null if there was no calldata to render.
  display: DisplayModel | null
  // True if the contract passed the verification gate, so an ABI exists.
  verified: boolean
  // The calldata read with the verified ABI. Null without one, or when
  // it has no function with the selector.
  decoded: Decoded | null
  source: DescriptorSource | null
  // False if the descriptor rendered as a preview: no auditor the user
  // trusts attested it.
  attested: boolean
}

export type Rendering =
  | { kind: 'transaction'; from: Hex | null; call: Call }
  | { kind: 'batch'; from: Hex | null; calls: Call[]; intent: string | null; warnings: Warning[] }
  | {
      kind: 'typedData'
      account: Hex
      typed: TypedData
      display: DisplayModel
      source: DescriptorSource | null
      attested: boolean
    }
  // A method that Clear Signing does not cover, or params with the
  // wrong shape.
  | { kind: 'none'; reason: string }

// A request, as the library takes it.
export type Input =
  | { kind: 'transaction'; from: Hex | null; to: Hex | null; data: Hex; value: bigint | null }
  | { kind: 'batch'; from: Hex | null; calls: { to: Hex | null; data: Hex; value: bigint | null }[] }
  | { kind: 'typedData'; account: Hex; typed: TypedData }
  | { kind: 'none'; reason: string }

// True if a descriptor rendered the data: the library sets the intent
// only then.
export function rendered(display: DisplayModel | null): boolean {
  return display?.intent !== undefined
}

// The warning that says why no descriptor rendered the data, if any.
export function reasonOf(display: DisplayModel | null): Warning | null {
  return display?.warnings?.find((warning) => warning.code !== 'INTERPOLATION_ERROR') ?? null
}

function isAddress(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}

function asAddress(value: unknown): Hex | null {
  return isAddress(value) ? (value.toLowerCase() as Hex) : null
}

function asData(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(value)) return '0x'
  return value.toLowerCase() as Hex
}

// A hex quantity, as EIP-1193 gives it, or a decimal string or number.
export function asValue(value: unknown): bigint | null {
  if (value === undefined || value === null || value === '') return 0n
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null
  if (typeof value !== 'string' || !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) return null
  return BigInt(value)
}

export function inputOf(request: SigningRequest): Input {
  const list = Array.isArray(request.params) ? request.params : []
  switch (request.method) {
    case 'eth_sendTransaction':
    case 'eth_signTransaction': {
      const tx = asRecord(list[0])
      if (!tx) return { kind: 'none', reason: 'the request has no transaction object' }
      return {
        kind: 'transaction',
        from: asAddress(tx.from),
        to: asAddress(tx.to),
        data: asData(tx.data ?? tx.input),
        value: asValue(tx.value),
      }
    }
    case 'wallet_sendCalls': {
      const batch = asRecord(list[0])
      if (!batch || !Array.isArray(batch.calls)) return { kind: 'none', reason: 'the request has no calls' }
      const calls = batch.calls.map((call) => {
        const record = asRecord(call) ?? {}
        return { to: asAddress(record.to), data: asData(record.data), value: asValue(record.value) }
      })
      return { kind: 'batch', from: asAddress(batch.from), calls }
    }
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4': {
      const account = asAddress(list[0])
      const typed = parseTypedData(list[1])
      if (!account || !typed) return { kind: 'none', reason: 'the request has no typed data' }
      return { kind: 'typedData', account, typed: { ...typed, account } }
    }
    default:
      return { kind: 'none', reason: `${request.method} carries no structured data` }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseTypedData(value: unknown): Omit<TypedData, 'account'> | null {
  let data = value
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return null
    }
  }
  const record = asRecord(data)
  const types = asRecord(record?.types)
  const domain = asRecord(record?.domain)
  const message = asRecord(record?.message)
  if (!record || !types || !domain || !message || typeof record.primaryType !== 'string') return null
  for (const members of Object.values(types)) {
    if (!Array.isArray(members)) return null
    for (const member of members) {
      const field = asRecord(member)
      if (typeof field?.name !== 'string' || typeof field.type !== 'string') return null
    }
  }
  return { types: types as TypedData['types'], primaryType: record.primaryType, domain, message }
}

// The ABI of a contract, from the Sourcify gate. Null if it did not pass.
export type Abis = (address: Hex) => unknown[] | null

export type RenderOptions = {
  chainId: number
  format: FormatOptions
  index: RegistryIndex
  // The names of the token lists that hold each address on the chain.
  listed: Map<Hex, string[]>
  abis: Abis
  // The name a token gives itself, read from the chain. Null if not read.
  tokenName?: (address: Hex) => Promise<string | null>
}

async function sourceOf(options: RenderOptions, address: Hex): Promise<DescriptorSource | null> {
  const { chainId, index, listed } = options
  const path = index.calldataIndex[`eip155:${chainId}:${address}`]
  if (path) return { kind: 'registry', path }
  const lists = listed.get(address)
  if (!lists) return null
  const name = (await options.tokenName?.(address).catch(() => null)) ?? null
  return { kind: 'template', lists, name }
}

// The format options without the attestation policy: the library then
// takes a descriptor that no trusted auditor attested.
function previewOptions(options: FormatOptions): FormatOptions {
  const resolver = options.descriptorResolverOptions
  return { ...options, descriptorResolverOptions: resolver && { ...resolver, attestations: undefined } }
}

type Attempt = { display: DisplayModel; attested: boolean }

// Renders with the policy first. If the only obstacle is the attestation,
// renders again without it, as a preview.
async function attempt(
  run: (options: FormatOptions) => Promise<DisplayModel>,
  options: FormatOptions,
): Promise<Attempt> {
  const display = await run(options)
  if (reasonOf(display)?.code !== 'NO_TRUSTED_ATTESTATION') return { display, attested: true }
  const preview = await run(previewOptions(options))
  return rendered(preview) ? { display: preview, attested: false } : { display, attested: true }
}

async function renderCall(
  call: { to: Hex | null; data: Hex; value: bigint | null },
  from: Hex | null,
  options: RenderOptions,
): Promise<Call> {
  const { to, data, value } = call
  const abi = to ? options.abis(to) : null
  const verified = abi !== null
  const decoded = abi && data !== '0x' ? decodeCalldata(abi, data) : null
  if (!to || data === '0x') {
    return { to, data, value, display: null, verified, decoded, source: null, attested: true }
  }
  const tx = { chainId: options.chainId, to, data, value: value ?? undefined, from: from ?? undefined }
  const { display, attested } = await attempt((format_) => format(tx, format_), options.format)
  const source = rendered(display) ? await sourceOf(options, to) : null
  return { to, data, value, display, verified, decoded, source, attested }
}

export async function render(input: Input, options: RenderOptions): Promise<Rendering> {
  switch (input.kind) {
    case 'transaction':
      return { kind: 'transaction', from: input.from, call: await renderCall(input, input.from, options) }
    case 'batch': {
      // The batch call of the library gives the joined intent. Each call
      // renders on its own here too, for the ABI decoding and the source.
      const batch = {
        chainId: options.chainId,
        from: input.from ?? undefined,
        calls: input.calls.map((call) => ({
          to: call.to ?? undefined,
          data: call.data === '0x' ? undefined : call.data,
          value: call.value ?? undefined,
        })),
      }
      const [joined, calls] = await Promise.all([
        formatEip5792Batch(batch, options.format),
        Promise.all(input.calls.map((call) => renderCall(call, input.from, options))),
      ])
      return {
        kind: 'batch',
        from: input.from,
        calls,
        intent: joined.interpolatedIntent ?? null,
        warnings: joined.warnings ?? [],
      }
    }
    case 'typedData': {
      const { display, attested } = await attempt((format_) => formatTypedData(input.typed, format_), options.format)
      const contract = asAddress(input.typed.domain.verifyingContract)
      const entries = contract ? options.index.typedDataIndex[`eip155:${options.chainId}:${contract}`] : undefined
      const path = entries?.[input.typed.primaryType]?.[0]?.path
      const source: DescriptorSource | null = rendered(display) && path ? { kind: 'registry', path } : null
      return { kind: 'typedData', account: input.account, typed: input.typed, display, source, attested }
    }
    case 'none':
      return input
  }
}

// A quantity in units, without trailing zeros: 1500000 with 6 decimals
// is "1.5".
export function formatAmount(value: bigint, decimals: number): string {
  const text = formatUnits(value, decimals)
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}
