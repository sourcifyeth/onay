// The second gate: what Sourcify says about a contract, reproduced. The
// server gives the sources, the compiler settings and the creation
// transaction, all of it a claim. The gate recompiles the sources and
// compares the result with the code that the first gate read. This
// module takes `fetch` and the compiler as parameters, so the tests run
// it as it is.

import type { Hex } from '../messages.ts'
import type { Fetch, Gate, Log } from './gate.ts'
import type { Solc } from './solc.ts'
import { verify, type Verified } from './verify.ts'

export const SOURCIFY_SERVER = 'https://sourcify.dev/server'

const TIMEOUT = 15_000

// Sourcify's own verdict. 'exact_match' includes the metadata hash.
export type MatchStatus = 'exact_match' | 'match' | null

// The standard JSON input of the compiler. Gate 2 gives it to solc as it
// is, so only the parts that this module reads are typed.
export type StdJsonInput = {
  language: string
  sources: Record<string, unknown>
  settings?: Record<string, unknown>
}

export type Deployment = {
  transactionHash: Hex
  blockNumber: number
  transactionIndex: number
  deployer: Hex
}

export type Found = {
  runtimeMatch: MatchStatus
  creationMatch: MatchStatus
  language: string
  compilerVersion: string
  // The contract in the sources: its name, and the path of its file.
  name: string
  path: string
  stdJsonInput: StdJsonInput
  // Null if Sourcify does not know the creation transaction.
  deployment: Deployment | null
}

const FIELDS = [
  'stdJsonInput',
  'compilation.language',
  'compilation.compilerVersion',
  'compilation.fullyQualifiedName',
  'deployment',
].join(',')

export function lookupUrl(chainId: number, address: Hex): string {
  return `${SOURCIFY_SERVER}/v2/contract/${chainId}/${address}?fields=${FIELDS}`
}

// Verifications by chain and code, so that a contract that is in many
// requests, or at many addresses, compiles once.
const verified = new Map<string, Promise<Verified>>()

export function sourcifyGateFor(
  chainId: number,
  fetch: Fetch,
  solc: Solc,
): Gate<{ address: Hex; code: Hex }, Verified> {
  return {
    source: 'sourcify',
    async run({ address, code }, log) {
      const key = `${chainId}:${code}`
      let result = verified.get(key)
      if (result) {
        log({ source: 'sourcify', text: `${address} · same code verified before in this session`, ok: true })
        return result
      }
      result = (async () => {
        const found = await lookup(chainId, address, fetch, log)
        if (!found) throw new Error('not verified on Sourcify · nothing to compile')
        if (found.language !== 'Solidity')
          throw new Error(`${found.language} sources · only Solidity can be compiled here`)
        return verify(chainId, address, code, found, solc, log)
      })()
      verified.set(key, result)
      return result.catch((error: unknown) => {
        // The next request tries again.
        verified.delete(key)
        throw error
      })
    },
  }
}

// What Sourcify claims. Null if it has nothing for the address.
export async function lookup(chainId: number, address: Hex, fetch: Fetch, log: Log): Promise<Found | null> {
  log({ source: 'sourcify', text: `looking up ${address}` })
  let response: Response
  try {
    response = await fetch(lookupUrl(chainId, address), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    })
  } catch (error) {
    throw new Error(`Sourcify did not answer: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (response.status === 404) return null
  if (response.status === 429) throw new Error('Sourcify answered 429: too many requests, try again later')
  if (!response.ok) throw new Error(`Sourcify answered HTTP ${response.status}`)
  const found = parseLookup(await response.json())
  logFound(found, log)
  return found
}

function logFound(lookup: Found, log: Log) {
  const files = Object.keys(lookup.stdJsonInput.sources).length
  log({
    source: 'sourcify',
    text: `${lookup.name} · ${lookup.language} ${lookup.compilerVersion} · ${files} ${files === 1 ? 'file' : 'files'}`,
  })
  log({
    source: 'sourcify',
    text: `claims runtime ${matchText(lookup.runtimeMatch)} · creation ${matchText(lookup.creationMatch)} · not trusted, reproduced next`,
  })
}

function matchText(status: MatchStatus): string {
  return status === null ? 'no match' : status.replace('_', ' ')
}

// The body of a 200 answer. The server is not trusted, so each field that
// the app reads is checked.
export function parseLookup(body: unknown): Found {
  const record = asRecord(body, 'the answer')
  const compilation = asRecord(record.compilation, 'compilation')
  const stdJsonInput = asRecord(record.stdJsonInput, 'stdJsonInput')
  const sources = asRecord(stdJsonInput.sources, 'stdJsonInput.sources')
  const settings = asRecord(stdJsonInput.settings ?? {}, 'stdJsonInput.settings')
  // "path/File.sol:Name"
  const qualified = asString(compilation.fullyQualifiedName, 'compilation.fullyQualifiedName')
  const colon = qualified.lastIndexOf(':')
  if (colon < 1 || colon === qualified.length - 1) throw unexpected('compilation.fullyQualifiedName')
  return {
    runtimeMatch: asMatch(record.runtimeMatch, 'runtimeMatch'),
    creationMatch: asMatch(record.creationMatch, 'creationMatch'),
    language: asString(compilation.language, 'compilation.language'),
    compilerVersion: asString(compilation.compilerVersion, 'compilation.compilerVersion'),
    name: qualified.slice(colon + 1),
    path: qualified.slice(0, colon),
    stdJsonInput: { language: asString(stdJsonInput.language, 'stdJsonInput.language'), sources, settings },
    deployment: record.deployment == null ? null : parseDeployment(record.deployment),
  }
}

function parseDeployment(value: unknown): Deployment {
  const record = asRecord(value, 'deployment')
  return {
    transactionHash: asHex(record.transactionHash, 64, 'deployment.transactionHash'),
    blockNumber: asCount(record.blockNumber, 'deployment.blockNumber'),
    transactionIndex: asCount(record.transactionIndex, 'deployment.transactionIndex'),
    deployer: asHex(record.deployer, 40, 'deployment.deployer'),
  }
}

function unexpected(field: string): Error {
  return new Error(`Sourcify answered with an unexpected ${field}`)
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw unexpected(field)
  return value as Record<string, unknown>
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') throw unexpected(field)
  return value
}

function asMatch(value: unknown, field: string): MatchStatus {
  if (value !== 'exact_match' && value !== 'match' && value !== null) throw unexpected(field)
  return value
}

function asHex(value: unknown, digits: number, field: string): Hex {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-fA-F]{${digits}}$`).test(value)) throw unexpected(field)
  return value as Hex
}

// The API gives block numbers and indexes as decimal strings.
function asCount(value: unknown, field: string): number {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) throw unexpected(field)
  const count = Number(value)
  if (!Number.isSafeInteger(count)) throw unexpected(field)
  return count
}
