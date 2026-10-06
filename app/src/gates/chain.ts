// The first gate: the code of the contract, read as verified chain state.
// Helios must be ready first. That check is for the chain, so it runs once
// for each request, not once for each contract.

import { invoke } from '@tauri-apps/api/core'
import type { ChainReady, ChainReadyArgs, ChainRequestArgs, Hex } from '../messages.ts'
import type { Gate, Log } from './gate.ts'

export type Target = { chainId: number; address: Hex; block: number }

export type ChainCode = Target & {
  // '0x' if the address has no code.
  code: Hex
}

// The first sync after the app starts can be slow.
const SYNC_TIMEOUT = 120_000

export const CHAIN_NAMES: Record<number, string> = { 1: 'Ethereum mainnet', 11155111: 'Sepolia' }

// Waits until Helios is synced and its head is recent. Returns the block
// that each gate of the request reads from, so that all see the same state.
export async function chainReady(chainId: number, log: Log): Promise<number> {
  log({ source: 'helios', text: `waiting for the light client · ${CHAIN_NAMES[chainId] ?? `chain ${chainId}`}` })
  const ready = invoke<ChainReady>('chain_ready', { chainId } satisfies ChainReadyArgs)
  const { block, checkpoint } = await withTimeout(ready, SYNC_TIMEOUT, 'Helios did not sync in time')
  log({
    source: 'helios',
    text: `in sync · finalized checkpoint ${checkpoint ? short(checkpoint) : 'unknown'}`,
    ok: true,
  })
  log({ source: 'helios', text: `head is recent · block ${block.toLocaleString('en-US')} · under 60 s old`, ok: true })
  return block
}

export const chainGate: Gate<Target, ChainCode> = {
  source: 'helios',
  async run(target, log) {
    const { chainId, address, block } = target
    const args: ChainRequestArgs = { chainId, method: 'eth_getCode', params: [address, `0x${block.toString(16)}`] }
    const code = await invoke<Hex>('chain_request', args)
    // Helios rejects code that does not match the account proof.
    const result = code === '0x' ? 'empty · not a contract' : `${(code.length - 2) / 2} bytes · merkle proof verified`
    log({ source: 'helios', text: `eth_getCode ${address} · ${result}`, ok: true })
    return { ...target, code }
  },
}

function short(hash: Hex): string {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  return Promise.race([promise, timeout])
}
