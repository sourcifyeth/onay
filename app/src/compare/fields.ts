// What the user compares between Onay and the wallet, for each kind of
// request: the fields that wallets show, and the ERC-8213 digest that
// stands for the data. A page can show Onay one request and the wallet
// another; a field that differs gives it away. This module has no
// browser or Tauri calls, so the tests run it as it is.

import { getAddress } from 'ethers'
import { inputOf } from '../clear-signing/render.ts'
import { authorizationsOf, messageOf, parseChainId, requestProblem } from '../gates/request.ts'
import type { Hex, SigningRequest } from '../messages.ts'
import { calldataDigest, erc191Digest, typedDataDigests, type TypedDataDigests } from './digest.ts'

// Addresses carry the EIP-55 checksum, as wallets show them.
export type CallFields = {
  // Null if the call creates a contract.
  to: string | null
  // Null if the request gave no quantity.
  value: bigint | null
  data: Hex
  // The length of the calldata in bytes.
  length: number
  selector: Hex | null
  // Null without calldata: ERC-8213 shows no digest then.
  digest: Hex | null
}

export type Delegation = { chainId: bigint; address: string; nonce: bigint }

// Only the fields that the EIP712Domain type lists: the wallet signs no
// other field of the domain.
export type DomainFields = {
  name: string | null
  version: string | null
  verifyingContract: string | null
  // False if the EIP712Domain type lists no chainId: the signature then
  // holds on every chain.
  hasChain: boolean
  // Null if the domain has no chain id that Onay reads.
  chainId: number | null
}

export type Fields =
  | { kind: 'transaction'; from: string | null; call: CallFields; delegations: Delegation[] }
  | { kind: 'batch'; from: string | null; calls: CallFields[] }
  | {
      kind: 'typedData'
      signer: string
      domain: DomainFields
      primaryType: string
      // Null with the reason when the data does not hash one way in
      // every wallet.
      digests: TypedDataDigests | null
      reason: string | null
    }
  | {
      kind: 'message'
      signer: string | null
      bytes: Uint8Array
      // Null if the bytes are not UTF-8 text.
      text: string | null
      // Control or format characters, such as a zero-width space or a
      // change of text direction: they do not show, or show wrongly.
      hidden: boolean
      // Letters outside ASCII can look like ASCII ones.
      nonAscii: boolean
      // Null with the reason when wallets do not hash the message in one
      // way.
      digest: Hex | null
      reason: string | null
    }
  | { kind: 'none'; reason: string }

function checksum(address: Hex | null): string | null {
  return address === null ? null : getAddress(address)
}

function callFields(call: { to: Hex | null; data: Hex; value: bigint | null }): CallFields {
  const length = (call.data.length - 2) / 2
  return {
    to: checksum(call.to),
    value: call.value,
    data: call.data,
    length,
    selector: length >= 4 ? (call.data.slice(0, 10) as Hex) : null,
    digest: length === 0 ? null : calldataDigest(call.data),
  }
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

// Control characters other than tab and line breaks, separators other
// than the space, format characters, characters that show nothing, and
// the blank braille pattern.
const HIDDEN = /[^\P{Cc}\t\n\r]|[^\P{Z} ]|\p{Cf}|\p{Default_Ignorable_Code_Point}|⠀/u

// ERC-8213 defines the ERC-191 Digest for personal_sign only.
const ETH_SIGN =
  'wallets sign the data of eth_sign in different ways, with or without the ERC-191 prefix, and ERC-8213 defines no digest for it'

function messageFields(bytes: Uint8Array, signer: Hex | null, method: string): Fields {
  let text: string | null = null
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    // Not UTF-8: the message shows as hex.
  }
  return {
    kind: 'message',
    signer: checksum(signer),
    bytes,
    text,
    hidden: text !== null && HIDDEN.test(text),
    nonAscii: text !== null && /\P{ASCII}/u.test(text),
    digest: method === 'personal_sign' ? erc191Digest(bytes) : null,
    reason: method === 'personal_sign' ? null : ETH_SIGN,
  }
}

export function fieldsOf(request: SigningRequest): Fields {
  const problem = requestProblem(request)
  if (problem) return { kind: 'none', reason: `the request could not be read · ${problem}` }
  // requestProblem has already refused a message with a problem.
  const message = messageOf(request)
  if (message && message.problem === undefined) return messageFields(message.bytes, message.signer, request.method)
  if (request.method === 'eth_signTypedData') {
    return { kind: 'none', reason: 'this is typed data in the old format, for which ERC-8213 defines no digest' }
  }
  const input = inputOf(request)
  switch (input.kind) {
    case 'transaction': {
      const authorizations = authorizationsOf(request)
      const delegations = (Array.isArray(authorizations) ? authorizations : []).map((entry) => ({
        ...entry,
        address: getAddress(entry.address),
      }))
      return { kind: 'transaction', from: checksum(input.from), call: callFields(input), delegations }
    }
    case 'batch':
      return { kind: 'batch', from: checksum(input.from), calls: input.calls.map(callFields) }
    case 'typedData': {
      const { domain } = input.typed
      const members: unknown = input.typed.types.EIP712Domain
      const contract = asText(domain.verifyingContract)
      const { digests, reason } = typedDataDigests(input.typed, request.method === 'eth_signTypedData_v3' ? 'v3' : 'v4')
      return {
        kind: 'typedData',
        signer: getAddress(input.account),
        domain: {
          name: asText(domain.name),
          version: asText(domain.version),
          verifyingContract:
            contract && /^0x[0-9a-fA-F]{40}$/.test(contract) ? getAddress(contract.toLowerCase()) : contract,
          hasChain: Array.isArray(members) && members.some((member) => member?.name === 'chainId'),
          chainId: parseChainId(domain.chainId),
        },
        primaryType: input.typed.primaryType,
        digests,
        reason: reason ?? null,
      }
    }
    case 'none':
      return input
  }
}
