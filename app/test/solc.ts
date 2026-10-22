// The real compiler for the tests that compile: the build of one version,
// downloaded once into test/.cache.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Fetch } from '../src/gates/gate.ts'
import { solcFor } from '../src/gates/solc.ts'

const CACHE = new URL('./.cache/', import.meta.url)

export const VERSION = '0.8.24+commit.e11b9ed9'

// binaries.soliditylang.org, through a file cache. The list is not
// cached: a test that needs a newer build must see it.
const cachedFetch: Fetch = async (url, init) => {
  if (url.endsWith('/list.json')) return fetch(url, init)
  mkdirSync(CACHE, { recursive: true })
  const file = new URL(url.slice(url.lastIndexOf('/') + 1), CACHE)
  try {
    return new Response(readFileSync(file))
  } catch {
    const response = await fetch(url, init)
    if (response.ok) writeFileSync(file, new Uint8Array(await response.clone().arrayBuffer()))
    return response
  }
}

export const solc = solcFor(cachedFetch)

type Compiled = { runtime: `0x${string}`; creation: `0x${string}`; selectors: Record<string, `0x${string}`> }

// Compiles one file and gives the bytecode and the selectors of each
// contract in it.
export async function compile(source: string, settings: object = {}): Promise<Record<string, Compiled>> {
  const selection = ['evm.deployedBytecode.object', 'evm.bytecode.object', 'evm.methodIdentifiers']
  const input = {
    language: 'Solidity',
    sources: { 'src/Test.sol': { content: source } },
    settings: { ...settings, outputSelection: { '*': { '*': selection } } },
  }
  const output = (await solc.compile(VERSION, input, () => {})) as {
    contracts: Record<
      string,
      Record<
        string,
        {
          evm: {
            deployedBytecode: { object: string }
            bytecode: { object: string }
            methodIdentifiers: Record<string, string>
          }
        }
      >
    >
  }
  const compiled: Record<string, Compiled> = {}
  for (const [name, { evm }] of Object.entries(output.contracts['src/Test.sol'])) {
    const selectors: Record<string, `0x${string}`> = {}
    for (const [signature, id] of Object.entries(evm.methodIdentifiers)) selectors[signature] = `0x${id}`
    compiled[name] = { runtime: `0x${evm.deployedBytecode.object}`, creation: `0x${evm.bytecode.object}`, selectors }
  }
  return compiled
}
