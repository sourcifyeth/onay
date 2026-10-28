// What the review of a transaction must show, as facts, not as text.
// `textsOf` turns the facts into the text of each section, so the
// wording of the page lives here and a transaction stays readable.

import { getAddress } from 'ethers'
import { count, formatEther, short } from '../src/gates/words.ts'
import type { AddRequestArgs, Hex } from '../src/messages.ts'
import type { Expectation, Mode } from './page.ts'

// The params of eth_sendTransaction.
export type Params = { from: Hex; to: Hex; data: Hex; value?: Hex }

// 'perfect': the bytecode is the same. 'partial': only the metadata hash
// differs.
export type Match = 'perfect' | 'partial'

// What a descriptor of the ERC-7730 registry renders for the call.
export type ClearSigning = {
  // The path of the descriptor in the registry.
  descriptor: string
  owner: string
  contractName: string
  intent: string
  // The label and the value of each field.
  fields: Record<string, string>
  attested: boolean
  // The token the amounts are in, read from the chain.
  token?: { symbol: string; decimals: number }
  // The ENS name of an address in the fields.
  ens?: string
}

export type Expected = {
  chain: {
    // The size of the code at the address.
    codeBytes: number
    // The block is null when another contract created this one: the
    // creation bytecode is then in an internal call, which is not read.
    creation: { transaction: Hex; block: number | null }
  }
  simulation: {
    // The contract that the call reaches first.
    frame: { name: string; selector: Hex }
    messages: number
    touched: number
    accounts: number
    slots: number
  }
  verification: {
    name: string
    compiler: string
    // The runs of the optimizer, or false.
    optimizer: number | false
    files: number
    mainFile: string
    runtime: Match
    // 'none' when the input of the creation transaction is not the
    // recompiled creation bytecode; null when it was not read (see
    // `chain.creation`). Both leave the contract verified by its runtime.
    creation: Match | 'none' | null
  }
  // Null while the registry has no descriptor for the contract. The
  // review cannot pass without one, so the test fails with that reason
  // until a descriptor lands and the file gets the object.
  clearSigning: ClearSigning | null
  decoded: {
    function: string
    // The type and the value of each parameter.
    params: Record<string, { type: string; value: string }>
  }
  compare: {
    // The ERC-8213 digest of the calldata.
    digest: Hex
  }
}

export type Transaction = {
  // The name of its file.
  id: string
  name: string
  params: Params
  expect: Expected
}

const CHAIN_ID = 1

// The log marks a preview as a failed check.
const PREVIEW_LINE = 'not attested by a trusted auditor'

// The notice of the Clear Signing step for a contract without a
// descriptor, its log line, and why the review cannot pass.
const NO_DESCRIPTOR = 'No ERC-7730 descriptor is registered for this contract'
const NO_DESCRIPTOR_LINE = 'not rendered · No descriptor found'
export const NO_DESCRIPTOR_PROBLEM = 'no ERC-7730 descriptor in the registry for this contract'

const isHex = (value: unknown) => typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value)

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

// A transaction from its file. The check is shallow: the keys that the
// request needs, and that each section of the expectation is there. A
// wrong value inside shows as a failed check with the text it produced.
export function parseTransaction(id: string, json: unknown): Transaction {
  const fail = (what: string): never => {
    throw new Error(`transactions/${id}.json: ${what}`)
  }
  if (!isRecord(json)) return fail('not an object')
  const { name, params, expect } = json
  if (typeof name !== 'string' || name === '') return fail('"name" must be a string')
  if (!isRecord(params)) return fail('"params" must be an object')
  for (const key of ['from', 'to', 'data']) {
    if (!isHex(params[key])) return fail(`"params.${key}" must be hex`)
  }
  if (params.value !== undefined && !isHex(params.value)) return fail('"params.value" must be hex')
  if (!isRecord(expect)) return fail('"expect" must be an object')
  for (const key of ['chain', 'simulation', 'verification', 'decoded', 'compare']) {
    if (!isRecord(expect[key])) return fail(`"expect.${key}" must be an object`)
  }
  if (expect.clearSigning !== null && !isRecord(expect.clearSigning)) {
    return fail('"expect.clearSigning" must be an object or null')
  }
  return { id, name, params: params as Params, expect: expect as Expected }
}

// The request as the user pastes it: the chain is in the params.
export function requestOf(transaction: Transaction): AddRequestArgs {
  return {
    method: 'eth_sendTransaction',
    params: [{ ...transaction.params, chainId: `0x${CHAIN_ID.toString(16)}` }],
    signed: false,
  }
}

const matchText = (match: Match) => (match === 'perfect' ? 'exact match' : 'match · the metadata hash differs')

const creationCompare = (creation: Expected['verification']['creation']) => {
  if (creation === null) return 'not compared · created by another contract'
  if (creation === 'none') return 'not compared · the input of the transaction is not the recompiled creation bytecode'
  return `✓ ${matchText(creation)}`
}

const creationText = ({ transaction, block }: Expected['chain']['creation']) =>
  `creation transaction ${short(transaction)} · ${block === null ? 'not read · created by another contract' : `block ${block.toLocaleString('en-US')}`}`

// The page lets a path break after each slash.
const breakable = (path: string) => path.split('/').join('/\u200b')

const selectorOf = (data: Hex) => data.slice(0, 10)

function clearSigningTexts(clearSigning: ClearSigning | null): string[] {
  if (clearSigning === null) return [NO_DESCRIPTOR]
  const attestation = clearSigning.attested ? 'attested by an auditor you trust' : 'attestation not confirmed'
  return [
    `Interacting with ${clearSigning.contractName} by ${clearSigning.owner}`,
    clearSigning.intent,
    ...Object.entries(clearSigning.fields).flat(),
    `ERC-7730 descriptor by ${clearSigning.owner} from the registry · ${attestation}`,
    `rendered with ${clearSigning.descriptor}${clearSigning.attested ? '' : ' · preview'}`,
    ...(clearSigning.token ? [`${clearSigning.token.symbol} · ${clearSigning.token.decimals} decimals`] : []),
    ...(clearSigning.ens ? [`${clearSigning.ens} · forward record matches`] : []),
  ]
}

// The warnings that the compare step lists, one line each: the chain
// without proof in RPC mode, and a descriptor that no trusted auditor
// attested.
function warningsOf(mode: Mode, clearSigning: ClearSigning | null): string[] {
  return [
    ...(mode === 'rpc'
      ? ['Step 1, Chain Data Verification: the chain data comes from an RPC endpoint, without proof']
      : []),
    ...(clearSigning && !clearSigning.attested
      ? ['Step 4, Clear Signing: the descriptor is a preview, since you trust no auditor yet']
      : []),
  ]
}

export function textsOf(transaction: Transaction, mode: Mode): Expectation {
  const { params, expect } = transaction
  const { chain, simulation, verification, clearSigning, decoded, compare } = expect
  const value = `${formatEther(BigInt(params.value ?? 0))} ETH`
  const optimizer = verification.optimizer === false ? 'off' : `${verification.optimizer} runs`
  const parameters = Object.entries(decoded.params).flatMap(([name, param]) => [`${name} ${param.type}`, param.value])
  const warnings = warningsOf(mode, clearSigning)
  return {
    chain: [
      mode === 'helios' ? '✓ Chain data verified by Helios' : '⚠ Chain data is not verified',
      `chain id ${CHAIN_ID} matches ✓`,
      `eth_getCode ${params.to} · ${chain.codeBytes} bytes`,
      creationText(chain.creation),
      `${simulation.touched}/${simulation.touched} contracts verified ✓`,
    ],
    simulation: [
      '✓ Simulated on',
      `${count(simulation.touched, 'contract')} touched`,
      simulation.frame.name,
      simulation.frame.selector,
      ...(params.value ? [value] : []),
      `executed · ${count(simulation.messages, 'message')} ✓`,
      `state read · ${count(simulation.accounts, 'account')} · ${count(simulation.slots, 'storage slot')} ·`,
      `call tree · ${count(simulation.touched, 'contract')} ✓`,
    ],
    // The card of the contract, not its log: a contract that an earlier
    // transaction of the run verified shows no log.
    verification: [
      verification.name,
      verification.runtime === 'perfect' && (verification.creation === 'perfect' || verification.creation === null)
        ? 'claims exact match'
        : 'claims match',
      '✓ verified',
      '✓ reproduced',
      `Runtime bytecode\n✓ ${matchText(verification.runtime)}`,
      `Creation bytecode\n${creationCompare(verification.creation)}`,
      `solc ${verification.compiler} · optimizer ${optimizer}`,
      `${count(verification.files, 'file')} · ${breakable(verification.mainFile)}`,
    ],
    clearSigning: clearSigningTexts(clearSigning),
    decoded: [
      `${decoded.function} · ${selectorOf(params.data)}`,
      ...(parameters.length > 0 ? parameters : ['no parameters']),
    ],
    raw: [params.from, params.to, value, params.data],
    // The compare step shows the addresses with their checksum.
    compare: [
      ...(warnings.length > 0
        ? ['⚠ Onay found warnings in this request', ...warnings]
        : ['Check that your wallet shows the same values.']),
      'Ethereum mainnet',
      getAddress(params.to),
      value,
      `${decoded.function} · ${selectorOf(params.data)}`,
      compare.digest,
      getAddress(params.from),
    ],
    // A warning does not change the verdict on the list.
    verdict: ['You pasted eth_sendTransaction', 'All checks passed.'],
    // The warnings are accepted. A preview logs as a failed check, and so
    // does a missing descriptor, which `fail` reports once.
    allow: [
      ...warnings,
      ...(clearSigning === null ? [NO_DESCRIPTOR_LINE] : clearSigning.attested ? [] : [PREVIEW_LINE]),
    ],
    ...(clearSigning === null ? { fail: NO_DESCRIPTOR_PROBLEM } : {}),
  }
}
