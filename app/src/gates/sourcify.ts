// What Sourcify says about a contract: the sources and the compiler
// settings that it verified, and the creation transaction. All of it is a
// claim. Gate 2 recompiles the sources, Gate 1 reads the transaction. This
// module takes `fetch` as a parameter, so the tests run it as it is.

import type { Hex } from '../messages.ts'
import type { Fetch, Gate, Log } from './gate.ts'

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

export type Lookup =
  | { found: false }
  | {
      found: true
      runtimeMatch: MatchStatus
      creationMatch: MatchStatus
      language: string
      compilerVersion: string
      name: string
      stdJsonInput: StdJsonInput
      // Null if Sourcify does not know the creation transaction.
      deployment: Deployment | null
    }

const FIELDS = [
  'stdJsonInput',
  'compilation.language',
  'compilation.compilerVersion',
  'compilation.name',
  'deployment',
].join(',')

export function lookupUrl(chainId: number, address: Hex): string {
  return `${SOURCIFY_SERVER}/v2/contract/${chainId}/${address}?fields=${FIELDS}`
}

export function sourcifyGateFor(chainId: number, fetch: Fetch): Gate<{ address: Hex }, Lookup> {
  return {
    source: 'sourcify',
    async run({ address }, log) {
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
      if (response.status === 404) {
        log({ source: 'sourcify', text: 'no sources · not verified on Sourcify' })
        return { found: false }
      }
      if (response.status === 429) throw new Error('Sourcify answered 429: too many requests, try again later')
      if (!response.ok) throw new Error(`Sourcify answered HTTP ${response.status}`)
      const lookup = parseLookup(await response.json())
      logFound(lookup, log)
      return lookup
    },
  }
}

function logFound(lookup: Lookup & { found: true }, log: Log) {
  const files = Object.keys(lookup.stdJsonInput.sources).length
  log({
    source: 'sourcify',
    text: `${lookup.name} · ${lookup.language} ${lookup.compilerVersion} · ${files} ${files === 1 ? 'file' : 'files'}`,
  })
  log({
    source: 'sourcify',
    text: `claims runtime ${matchText(lookup.runtimeMatch)} · creation ${matchText(lookup.creationMatch)} · not trusted, reproduced below`,
  })
}

function matchText(status: MatchStatus): string {
  return status === null ? 'no match' : status.replace('_', ' ')
}

// The body of a 200 answer. The server is not trusted, so each field that
// the app reads is checked.
export function parseLookup(body: unknown): Lookup & { found: true } {
  const record = asRecord(body, 'the answer')
  const compilation = asRecord(record.compilation, 'compilation')
  const stdJsonInput = asRecord(record.stdJsonInput, 'stdJsonInput')
  const sources = asRecord(stdJsonInput.sources, 'stdJsonInput.sources')
  const settings = asRecord(stdJsonInput.settings ?? {}, 'stdJsonInput.settings')
  return {
    found: true,
    runtimeMatch: asMatch(record.runtimeMatch, 'runtimeMatch'),
    creationMatch: asMatch(record.creationMatch, 'creationMatch'),
    language: asString(compilation.language, 'compilation.language'),
    compilerVersion: asString(compilation.compilerVersion, 'compilation.compilerVersion'),
    name: asString(compilation.name, 'compilation.name'),
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
