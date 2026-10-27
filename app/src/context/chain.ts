// The reads of the profile from the chain, through the same reader as
// the gates: in Helios mode each answer comes with a proof, in RPC mode
// from the endpoint without one. A block older than the window of
// EIP-2935 comes from the endpoint without proof, as for the creation
// transaction. This module takes the readers as parameters, so the tests
// run it with fakes.

import { oldBlock } from '../gates/creation.ts'
import { errorText } from '../gates/gate.ts'
import type { ChainRead } from '../gates/helios.ts'
import { parseQuantity } from '../gates/request.ts'
import type { Hex } from '../messages.ts'

export type ChainAccess = {
  read: ChainRead
  // The execution endpoint, without proof. Used only for an old block.
  fallback: ChainRead
  // True in Helios mode.
  proof: boolean
}

export type ChainValue<T> = {
  value: T
  proof: boolean
  // Why a value has no proof in Helios mode.
  note?: string
}

export type CodeKind = 'account' | 'contract' | 'delegated'

const tag = (block: number) => `0x${block.toString(16)}`

function asBigint(value: unknown, what: string): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new Error(`${what} did not read`)
  return BigInt(value)
}

// The balance in wei, from the account proof. No storage slot is asked.
export async function balance(chain: ChainAccess, address: Hex, block: number): Promise<ChainValue<bigint>> {
  const proof = (await chain.read('eth_getProof', [address, [], tag(block)])) as { balance?: unknown } | null
  return { value: asBigint(proof?.balance, 'the balance'), proof: chain.proof }
}

export async function codeKind(chain: ChainAccess, address: Hex, block: number): Promise<ChainValue<CodeKind>> {
  const code = await chain.read('eth_getCode', [address, tag(block)])
  if (typeof code !== 'string' || !/^0x[0-9a-fA-F]*$/.test(code)) throw new Error('eth_getCode gave no code')
  const kind: CodeKind = code === '0x' ? 'account' : /^0xef0100[0-9a-fA-F]{40}$/.test(code) ? 'delegated' : 'contract'
  return { value: kind, proof: chain.proof }
}

function parseBlockTime(block: unknown, number: number): number {
  const fields = block as { number?: unknown; timestamp?: unknown } | null
  if (typeof fields !== 'object' || fields === null) throw new Error(`block ${number} not found`)
  if (parseQuantity(fields.number) !== number) throw new Error(`the answer is not block ${number}`)
  const seconds = parseQuantity(fields.timestamp)
  if (seconds === null) throw new Error(`block ${number} has no time`)
  return seconds * 1000
}

// The time of a block in milliseconds since 1970.
export async function blockTime(chain: ChainAccess, number: number): Promise<ChainValue<number>> {
  const params = [tag(number), false]
  let block: unknown
  try {
    block = await chain.read('eth_getBlockByNumber', params)
  } catch (error) {
    const old = chain.proof ? oldBlock(errorText(error)) : null
    if (!old) throw error
    const fallback = await chain.fallback('eth_getBlockByNumber', params)
    return { value: parseBlockTime(fallback, number), proof: false, note: old }
  }
  return { value: parseBlockTime(block, number), proof: chain.proof }
}

const BALANCE_OF = '0x70a08231'

export function balanceOfData(holder: Hex): Hex {
  return `${BALANCE_OF}${holder.slice(2).toLowerCase().padStart(64, '0')}`
}

// `balanceOf(holder)` of an ERC-20 token.
export async function tokenBalance(
  chain: ChainAccess,
  token: Hex,
  holder: Hex,
  block: number,
): Promise<ChainValue<bigint>> {
  const result = await chain.read('eth_call', [{ to: token, data: balanceOfData(holder) }, tag(block)])
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64,}$/.test(result)) throw new Error('balanceOf gave no amount')
  return { value: BigInt(result.slice(0, 66)), proof: chain.proof }
}
