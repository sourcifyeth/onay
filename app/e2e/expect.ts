// What the review of a transaction must show, as facts, not as text.
// `textsOf` turns the facts into the text of each section, so the
// wording of the page lives here and a transaction stays readable.

import { count, formatEther, short } from '../src/gates/words.ts'
import type { AddRequestArgs, Hex } from '../src/messages.ts'
import type { Expectation } from './page.ts'

// The params of eth_sendTransaction.
export type Params = { from: Hex; to: Hex; data: Hex; value?: Hex }

// 'perfect': the bytecode is the same. 'partial': only the metadata hash
// differs.
export type Match = 'perfect' | 'partial'

export type Expected = {
  chain: {
    // The size of the code at the address.
    codeBytes: number
    creation: { transaction: Hex; block: number }
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
    creation: Match
  }
  clearSigning: {
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
  decoded: {
    function: string
    // The type and the value of each parameter.
    params: Record<string, { type: string; value: string }>
  }
  verdict: string
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
  for (const key of ['chain', 'simulation', 'verification', 'clearSigning', 'decoded']) {
    if (!isRecord(expect[key])) return fail(`"expect.${key}" must be an object`)
  }
  if (typeof expect.verdict !== 'string') return fail('"expect.verdict" must be a string')
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

const selectorOf = (data: Hex) => data.slice(0, 10)

export function textsOf(transaction: Transaction): Expectation {
  const { params, expect } = transaction
  const { chain, simulation, verification, clearSigning, decoded } = expect
  const value = `${formatEther(BigInt(params.value ?? 0))} ETH`
  const optimizer = verification.optimizer === false ? 'off' : `${verification.optimizer} runs`
  const attestation = clearSigning.attested ? 'attested by an auditor you trust' : 'attestation not confirmed'
  const parameters = Object.entries(decoded.params).flatMap(([name, param]) => [`${name} ${param.type}`, param.value])
  return {
    chain: [
      `chain id ${CHAIN_ID} matches ✓`,
      `eth_getCode ${params.to} · ${chain.codeBytes} bytes`,
      `creation transaction ${short(chain.creation.transaction)} · block ${chain.creation.block.toLocaleString('en-US')}`,
      '1/1 contracts verified ✓',
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
    verification: [
      verification.name,
      'claims match',
      '✓ verified',
      '✓ reproduced',
      `solc ${verification.compiler} · optimizer ${optimizer}`,
      `${count(verification.files, 'file')} · ${verification.mainFile}`,
      'sha256 matches the official list ✓',
      `runtime bytecode compare · ${matchText(verification.runtime)} ✓`,
      `creation bytecode compare · ${matchText(verification.creation)}`,
    ],
    clearSigning: [
      `Interacting with ${clearSigning.contractName} by ${clearSigning.owner}`,
      clearSigning.intent,
      ...Object.entries(clearSigning.fields).flat(),
      `ERC-7730 descriptor by ${clearSigning.owner} from the registry · ${attestation}`,
      `rendered with ${clearSigning.descriptor}${clearSigning.attested ? '' : ' · preview'}`,
      ...(clearSigning.token ? [`${clearSigning.token.symbol} · ${clearSigning.token.decimals} decimals`] : []),
      ...(clearSigning.ens ? [`${clearSigning.ens} · forward record matches`] : []),
    ],
    decoded: [
      `${decoded.function} · ${selectorOf(params.data)}`,
      ...(parameters.length > 0 ? parameters : ['no parameters']),
    ],
    raw: [params.from, params.to, value, params.data],
    verdict: ['You pasted eth_sendTransaction', expect.verdict],
    allow: clearSigning.attested ? [] : [PREVIEW_LINE],
  }
}
