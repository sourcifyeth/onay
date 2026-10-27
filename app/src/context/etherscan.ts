// What Etherscan claims about a contract for the profile, with the key of
// the user only: the creation transaction, and the first transaction.
// Both are fallbacks for an answer that Blockscout did not give. Each
// answer is a claim of the explorer, not checked here. This module takes
// `fetch` as a parameter, so the tests run it as it is.

import type { Fetch } from '../gates/gate.ts'
import type { Hex } from '../messages.ts'
import type { FirstTransaction } from './blockscout.ts'
import { ETHERSCAN_API, etherscanError, fetchJson, record, type Lookup } from './explorers.ts'

export type EtherscanCreation = {
  deployer: Hex
  transactionHash: Hex
  block: number | null
  // Milliseconds since 1970.
  time: number | null
}

const asAddress = (value: unknown): Hex | null =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value.toLowerCase() as Hex) : null

const asHash = (value: unknown): Hex | null =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value) ? (value.toLowerCase() as Hex) : null

function asCount(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[0-9]{1,15}$/.test(value)) return null
  return Number(value)
}

export function etherscanQuery(chainId: number, params: Record<string, string>, key: string): string {
  return `${ETHERSCAN_API}?${new URLSearchParams({ chainid: String(chainId), ...params, apikey: key })}`
}

export const creationUrl = (chainId: number, address: Hex, key: string) =>
  etherscanQuery(chainId, { module: 'contract', action: 'getcontractcreation', contractaddresses: address }, key)

export const txlistUrl = (chainId: number, address: Hex, key: string) =>
  etherscanQuery(
    chainId,
    { module: 'account', action: 'txlist', address, startblock: '0', page: '1', offset: '1', sort: 'asc' },
    key,
  )

// The rows of an answer. Null when Etherscan says that it has no data.
// Throws the reason for an error.
function rowsOf(body: unknown): unknown[] | null {
  const answer = record(body)
  if (!answer) throw new Error('an answer that does not read')
  const { result, message } = answer
  if (answer.status === '0' && typeof message === 'string' && /no (data|transactions|records) found/i.test(message)) {
    return null
  }
  if (typeof result === 'string') {
    const status = etherscanError(result)
    throw Object.assign(new Error(status.kind === 'unknown' ? status.reason : result), {
      limited: status.kind === 'unknown' && status.limited === true,
    })
  }
  if (answer.status !== '1' || !Array.isArray(result)) throw new Error('an answer that does not read')
  return result
}

export function parseCreation(body: unknown): EtherscanCreation | null {
  const rows = rowsOf(body)
  if (rows === null || rows.length === 0) return null
  const row = record(rows[0])
  const deployer = asAddress(row?.contractCreator)
  const transactionHash = asHash(row?.txHash)
  if (!deployer || !transactionHash) throw new Error('a creation that does not read')
  const time = asCount(row?.timestamp)
  return { deployer, transactionHash, block: asCount(row?.blockNumber), time: time === null ? null : time * 1000 }
}

export function parseFirstTransaction(body: unknown): FirstTransaction | null {
  const rows = rowsOf(body)
  if (rows === null || rows.length === 0) return null
  const row = record(rows[0])
  const hash = asHash(row?.hash)
  const time = asCount(row?.timeStamp)
  if (!hash || time === null) throw new Error('a transaction that does not read')
  return { hash, block: asCount(row?.blockNumber), time: time * 1000 }
}

async function ask<T>(url: string, fetch: Fetch, parse: (body: unknown) => T): Promise<Lookup<T>> {
  const answer = await fetchJson(url, fetch)
  if (!answer.ok) return answer
  if (answer.status !== 200) return { ok: false, reason: `HTTP ${answer.status}` }
  if (answer.body === undefined) return { ok: false, reason: 'an answer that is not JSON' }
  try {
    return { ok: true, value: parse(answer.body) }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return (error as { limited?: unknown }).limited === true
      ? { ok: false, reason, limited: true }
      : { ok: false, reason }
  }
}

// Without a key, no request goes out.
export function creation(
  chainId: number,
  address: Hex,
  key: string,
  fetch: Fetch,
): Promise<Lookup<EtherscanCreation | null>> {
  if (key.trim() === '') return Promise.resolve({ ok: false, reason: 'no API key · not asked' })
  return ask(creationUrl(chainId, address, key.trim()), fetch, parseCreation)
}

export function firstTransaction(
  chainId: number,
  address: Hex,
  key: string,
  fetch: Fetch,
): Promise<Lookup<FirstTransaction | null>> {
  if (key.trim() === '') return Promise.resolve({ ok: false, reason: 'no API key · not asked' })
  return ask(txlistUrl(chainId, address, key.trim()), fetch, parseFirstTransaction)
}
