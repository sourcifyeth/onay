// The compare: lib-sourcify's Verification over the sources that Sourcify
// gave and the code that the Helios gate read. The library never reaches
// the network: its chain object answers from what the gate read, and its
// compiler is the one of the app.

import {
  setLibSourcifyLoggerLevel,
  SolidityCompilation,
  SourcifyChain,
  Verification,
  type ISolidityCompiler,
  type SolidityJsonInput,
  type SolidityOutput,
  type Transformation,
  type TransformationValues,
} from '@ethereum-sourcify/lib-sourcify'
import type { Hex } from '../messages.ts'
import type { Log } from './gate.ts'
import type { Solc } from './solc.ts'
import type { Found } from './sourcify.ts'

// The library writes to the console. Keep its warnings and errors only.
setLibSourcifyLoggerLevel(1)

// 'perfect' includes the metadata hash, 'partial' is the code only.
export type Match = 'perfect' | 'partial'

export type Transformations = { list: Transformation[]; values: TransformationValues }

export type Verified = {
  // What Sourcify claimed.
  claim: Found
  // What the compare found.
  runtimeMatch: Match
  // Null until the creation transaction is read from the chain.
  creationMatch: Match | null
  transformations: { runtime: Transformations; creation: Transformations }
  // From the compile that matched, not from Sourcify.
  abi: unknown[]
}

// A chain that answers from what the Helios gate read.
class ReadChain extends SourcifyChain {
  private code: Hex

  constructor(chainId: number, code: Hex) {
    super({ name: 'read by the Helios gate', chainId, rpcs: [{ rpc: 'http://onay.invalid' }], supported: true })
    this.code = code
  }

  getBytecode = async () => this.code

  getTx = async (): Promise<never> => {
    throw new Error('the creation transaction is not read')
  }

  getTxReceipt = async (): Promise<never> => {
    throw new Error('the creation transaction is not read')
  }

  getContractCreationBytecodeAndReceipt = async (): Promise<never> => {
    throw new Error('the creation transaction is not read')
  }
}

function compilerFor(solc: Solc, log: Log): ISolidityCompiler {
  return {
    compile: (version, input) => solc.compile(version, input, log) as Promise<SolidityOutput>,
  }
}

export async function verify(
  chainId: number,
  address: Hex,
  code: Hex,
  claim: Found,
  solc: Solc,
  log: Log,
): Promise<Verified> {
  const compilation = new SolidityCompilation(
    compilerFor(solc, log),
    claim.compilerVersion,
    claim.stdJsonInput as SolidityJsonInput,
    { name: claim.name, path: claim.path },
  )
  log({ source: 'solc', text: `compiling ${claim.name} · ${claim.compilerVersion}` })
  const verification = new Verification(compilation, new ReadChain(chainId, code), address)
  await verification.verify()
  const { runtimeMatch, creationMatch } = verification.status
  if (!isMatch(runtimeMatch)) throw new Error('the recompiled runtime bytecode is not the code on chain')
  log({ source: 'sourcify', text: `runtime bytecode compare · ${matchText(runtimeMatch)}`, ok: true })
  const output = compilation.contractCompilerOutput as { abi?: unknown[] } | undefined
  return {
    claim,
    runtimeMatch,
    creationMatch: isMatch(creationMatch) ? creationMatch : null,
    transformations: verification.transformations,
    abi: output?.abi ?? [],
  }
}

function isMatch(status: unknown): status is Match {
  return status === 'perfect' || status === 'partial'
}

function matchText(match: Match): string {
  return match === 'perfect' ? 'exact match' : 'match · the metadata hash differs'
}
