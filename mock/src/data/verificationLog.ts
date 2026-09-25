import type { MockContract } from './mockRequest'

export type Tag = 'helios' | 'rpc' | 'sourcify' | 'verifier'

export interface LogLine {
  tag: Tag
  text: string
  delay: number // ms after previous line
  /** true renders a green check, false a coral cross */
  ok?: boolean
  stamp?: string // dmesg-style boot time, filled in by buildLog
}

/** the lines of reproducing one contract's Sourcify verification locally */
export function localVerificationLog(contract: MockContract): LogLine[] {
  if (contract.matchType === 'no match') {
    return [
      { tag: 'sourcify', text: `looking up ${contract.address}`, delay: 300 },
      { tag: 'sourcify', text: 'no match found on Sourcify · nothing to compile', delay: 500, ok: false },
    ]
  }
  return [
    { tag: 'sourcify', text: `fetching sources for ${contract.address} · ${contract.sources.length} files`, delay: 300 },
    { tag: 'sourcify', text: 'solc 0.8.24+commit.e11b9ed9 · wasm · hash verified against solc-bin', delay: 300, ok: true },
    { tag: 'sourcify', text: 'compiling…', delay: 500 },
    { tag: 'sourcify', text: `runtime bytecode compare · ${contract.matchType}`, delay: 300, ok: true },
  ]
}

/** placeholder light-client state, the same for every request in the mock */
export const HELIOS_STATE = {
  checkpoint: '0xa41c…9be2',
  checkpointAge: '3 hours',
  signatures: 512,
  slot: 9_214_336,
}

/** the lines of the light client syncing to the finalized head */
export function heliosSyncLog(chain: string): LogLine[] {
  const { checkpoint, checkpointAge, signatures, slot } = HELIOS_STATE
  return [
    { tag: 'helios', text: `starting light client · network=${chain}`, delay: 250 },
    { tag: 'helios', text: `checkpoint ${checkpoint} · age ${checkpointAge} · within weak subjectivity window`, delay: 300 },
    { tag: 'helios', text: `sync committee verified · ${signatures}/${signatures} signatures`, delay: 350, ok: true },
    { tag: 'helios', text: `finalized head · slot ${slot.toLocaleString('en-US')} · in sync`, delay: 250 },
  ]
}

/** reading one address's code; only Helios mode checks it against a proof */
export function codeReadLog(address: string, helios: boolean, empty = false): LogLine {
  const result = empty ? 'empty · recipient is not a contract' : null
  if (helios) {
    return {
      tag: 'helios',
      text: `eth_getCode ${address} · ${result ?? 'merkle proof verified'}`,
      delay: 300,
      ok: true,
    }
  }
  return {
    tag: 'rpc',
    text: `eth_getCode ${address} · ${result ?? 'no proof, taken from the endpoint'}`,
    delay: 300,
  }
}
