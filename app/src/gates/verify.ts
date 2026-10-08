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
import type { Creation, CreationRead } from './creation.ts'
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
  // Null if the creation transaction was not read, or if its input is
  // not the recompiled creation bytecode. The note says which, or that
  // the transaction came without proof.
  creationMatch: Match | null
  creationNote: string | null
  transformations: { runtime: Transformations; creation: Transformations }
  // From the compile that matched, not from Sourcify.
  abi: unknown[]
}

type Tx = Awaited<ReturnType<SourcifyChain['getTx']>>
type Receipt = Awaited<ReturnType<SourcifyChain['getTxReceipt']>>

// A chain that answers from what the Helios gate read.
class ReadChain extends SourcifyChain {
  private address: Hex
  private code: Hex
  private creation: Creation | null

  constructor(chainId: number, address: Hex, code: Hex, creation: Creation | null) {
    super({ name: 'read by the Helios gate', chainId, rpcs: [{ rpc: 'http://onay.invalid' }], supported: true })
    this.address = address
    this.code = code
    this.creation = creation
  }

  getBytecode = async () => this.code

  getTx = async (hash: string): Promise<Tx> => {
    const creation = this.read(hash)
    const tx = { hash, blockNumber: creation.blockNumber, from: creation.deployer, data: creation.input }
    return tx as unknown as Tx
  }

  getTxReceipt = async (hash: string): Promise<Receipt> => {
    const creation = this.read(hash)
    const receipt = { hash, index: creation.transactionIndex, contractAddress: this.address }
    return receipt as unknown as Receipt
  }

  // The gate read a transaction that deployed the contract directly, so
  // its input is the creation bytecode.
  getContractCreationBytecodeAndReceipt = async (_address: string, hash: string) => ({
    creationBytecode: this.read(hash).input,
    txReceipt: await this.getTxReceipt(hash),
  })

  private read(hash: string): Creation {
    if (!this.creation || this.creation.transactionHash !== hash) throw new Error('the transaction is not read')
    return this.creation
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
  read: CreationRead,
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
  const chain = new ReadChain(chainId, address, code, read.creation)
  const verification = new Verification(compilation, chain, address, read.creation?.transactionHash)
  await verification.verify()
  const { runtimeMatch, creationMatch } = verification.status
  if (!isMatch(runtimeMatch)) throw new Error('the recompiled runtime bytecode is not the code on chain')
  log({ source: 'sourcify', text: `runtime bytecode compare · ${matchText(runtimeMatch)}`, ok: true, proof: true })
  let creationNote: string | null = null
  if (read.creation) {
    if (isMatch(creationMatch)) {
      const { verified } = read.creation
      const text = `creation bytecode compare · ${matchText(creationMatch)}${verified ? '' : ' · transaction without proof'}`
      log({ source: 'sourcify', text, ok: true, proof: verified })
      if (!verified) creationNote = 'the transaction was read without proof'
    } else {
      creationNote = 'the input of the transaction is not the recompiled creation bytecode'
      log({ source: 'sourcify', text: `creation bytecode compare · no match · ${creationNote}` })
    }
  } else creationNote = read.reason
  const output = compilation.contractCompilerOutput as { abi?: unknown[] } | undefined
  return {
    claim,
    runtimeMatch,
    creationMatch: isMatch(creationMatch) ? creationMatch : null,
    creationNote,
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
