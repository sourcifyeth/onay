// The first gate: the code of the contract, read from the chain. In Helios
// mode the light client checks it with a proof. In RPC mode it comes from
// the endpoint without a check.
//
// The chain must be ready first. That check is for the chain, so it runs
// once for each request, not once for each contract.

import { invoke } from '@tauri-apps/api/core'
import { heliosStarted, type ChainConfig } from '../chains.ts'
import type { ChainReady, ChainReadyArgs, ChainRequestArgs, Hex } from '../messages.ts'
import { parseCreation, type CreationRead, type CreationReader } from './creation.ts'
import { errorText, type Gate, type Log } from './gate.ts'
import { parseQuantity } from './request.ts'

export type Target = { address: Hex; block: number }

export type ChainCode = Target & {
  // '0x' if the address has no code.
  code: Hex
}

// The first sync after the app starts can be slow.
const SYNC_TIMEOUT = 120_000
const RPC_TIMEOUT = 15_000

export type Head = {
  // The block that each gate of the request reads from, so that all see
  // the same state.
  block: number
  // The finalized checkpoint that Helios synced from. Null in RPC mode.
  checkpoint: Hex | null
}

export function chainReady(chain: ChainConfig, log: Log): Promise<Head> {
  return chain.mode === 'helios' ? heliosReady(chain, log) : rpcReady(chain, log)
}

async function heliosReady(chain: ChainConfig, log: Log): Promise<Head> {
  log({ source: 'helios', text: `waiting for the light client · ${chain.name}` })
  const ready = heliosStarted(chain.id).then(() =>
    invoke<ChainReady>('chain_ready', { chainId: chain.id } satisfies ChainReadyArgs),
  )
  const { block, checkpoint } = await withTimeout(ready, SYNC_TIMEOUT, 'Helios did not sync in time')
  log({
    source: 'helios',
    text: `in sync · finalized checkpoint ${checkpoint ? short(checkpoint) : 'unknown'}`,
    ok: true,
    proof: true,
  })
  log({
    source: 'helios',
    text: `head is recent · block ${block.toLocaleString('en-US')} · under 60 s old`,
    ok: true,
    proof: true,
  })
  return { block, checkpoint: checkpoint ?? null }
}

async function rpcReady(chain: ChainConfig, log: Log): Promise<Head> {
  log({
    source: 'rpc',
    text: `you are trusting ${new URL(chain.executionRpc).host} · its answers cannot be verified`,
    proof: false,
  })
  const chainId = parseQuantity(await rpcRequest(chain.executionRpc, 'eth_chainId', []))
  if (chainId !== chain.id) throw new Error(`the endpoint serves chain ${chainId}, not chain ${chain.id}`)
  log({ source: 'rpc', text: `chain id ${chainId} matches`, ok: true, proof: false })
  const block = parseQuantity(await rpcRequest(chain.executionRpc, 'eth_blockNumber', []))
  if (block === null) throw new Error('eth_blockNumber gave no block number')
  log({ source: 'rpc', text: `head · block ${block.toLocaleString('en-US')}`, proof: false })
  return { block, checkpoint: null }
}

export function heliosGateFor(chain: ChainConfig): Gate<Target, ChainCode> {
  const helios = chain.mode === 'helios'
  return {
    source: chain.mode,
    async run(target, log) {
      const params = [target.address, `0x${target.block.toString(16)}`]
      const code = helios
        ? await invoke<Hex>('chain_request', {
            chainId: chain.id,
            method: 'eth_getCode',
            params,
          } satisfies ChainRequestArgs).catch((error) => {
            throw new Error(explainProofError(errorText(error), chain))
          })
        : await rpcRequest(chain.executionRpc, 'eth_getCode', params)
      if (typeof code !== 'string' || !/^0x[0-9a-fA-F]*$/.test(code)) throw new Error('eth_getCode gave no code')
      // Helios rejects code that does not match the account proof.
      const size = code === '0x' ? 'empty · not a contract' : `${(code.length - 2) / 2} bytes`
      const check = helios ? 'merkle proof verified' : 'no proof'
      log({
        source: chain.mode,
        text: `eth_getCode ${target.address} · ${size} · ${check}`,
        ok: helios ? true : undefined,
        proof: helios,
      })
      return { ...target, code: code as Hex }
    },
  }
}

// Reads the transaction that deployed a contract, and its receipt. In
// Helios mode both come from a block whose hash is checked through
// EIP-2935, so the block must be one of the newest 8191. An older block
// comes from the execution endpoint without proof: the creation compare
// says how the contract was deployed, not what runs at the address, and
// the runtime compare covers that with a proof.
export function creationReaderFor(chain: ChainConfig, log: Log): CreationReader {
  const helios = chain.mode === 'helios'
  const host = new URL(chain.executionRpc).host
  const read = async (transactionHash: Hex, verified: boolean) => {
    const request = (method: string) =>
      verified
        ? invoke<unknown>('chain_request', {
            chainId: chain.id,
            method,
            params: [transactionHash],
          } satisfies ChainRequestArgs).catch((error) => {
            throw new Error(errorText(error))
          })
        : rpcRequest(chain.executionRpc, method, [transactionHash])
    const [tx, receipt] = await Promise.all([request('eth_getTransactionByHash'), request('eth_getTransactionReceipt')])
    return { tx, receipt }
  }
  return async (address, transactionHash): Promise<CreationRead> => {
    const name = `creation transaction ${short(transactionHash)}`
    const notRead = (error: unknown, retry: boolean): CreationRead => {
      const reason = errorText(error)
      log({ source: chain.mode, text: `${name} · not read · ${reason}` })
      return { creation: null, reason, retry }
    }
    let answers: { tx: unknown; receipt: unknown }
    let verified = helios
    let check = helios ? 'block hash and receipts root verified' : `from ${host} · no proof`
    try {
      try {
        answers = await read(transactionHash, verified)
      } catch (error) {
        const old = helios ? oldBlock(errorText(error)) : null
        if (!old) throw error
        verified = false
        answers = await read(transactionHash, verified)
        check = `${old} · from ${host} without proof`
      }
    } catch (error) {
      // The endpoint, or Helios, did not answer. The next request asks again.
      return notRead(error, true)
    }
    let creation
    try {
      creation = parseCreation(address, transactionHash, answers.tx, answers.receipt, verified)
    } catch (error) {
      return notRead(error, false)
    }
    log({
      source: chain.mode,
      text: `${name} · block ${creation.blockNumber.toLocaleString('en-US')} · ${check}`,
      ok: verified ? true : undefined,
      proof: verified,
    })
    return { creation }
  }
}

// Helios says "block N is outside EIP-2935 ring buffer range (latest: M,
// buffer size: 8191)". Null for any other error.
function oldBlock(message: string): string | null {
  const old = /block (\d+) is outside EIP-2935 ring buffer range \(latest: (\d+), buffer size: (\d+)\)/.exec(message)
  if (!old) return null
  const [, block, latest, size] = old
  const age = Number(latest) - Number(block)
  return `${age.toLocaleString('en-US')} blocks old · Helios can verify the newest ${Number(size).toLocaleString('en-US')} only`
}

// Helios asks the execution endpoint for a proof at its own head block.
// Some endpoints serve proofs for their newest block only, or need a key
// for older blocks. Both errors come from the endpoint, so say so.
function explainProofError(message: string, chain: ChainConfig): string {
  const host = new URL(chain.executionRpc).host
  if (/proof window/i.test(message)) {
    return `${host} serves proofs for its newest block only, and Helios is a few blocks behind it. Choose an execution endpoint that serves eth_getProof for recent blocks, in the settings.`
  }
  if (/archive/i.test(message)) {
    return `${host} needs a key for this block. Choose another execution endpoint in the settings.`
  }
  return message
}

let nextRpcId = 1

// One JSON-RPC call to an endpoint in RPC mode. The answer must carry the
// id of the request.
async function rpcRequest(url: string, method: string, params: unknown[]): Promise<unknown> {
  const id = nextRpcId++
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT),
  })
  if (!response.ok) throw new Error(`${method}: the endpoint answered HTTP ${response.status}`)
  const answer = (await response.json()) as { id?: unknown; result?: unknown; error?: { message?: unknown } } | null
  if (typeof answer !== 'object' || answer === null) throw new Error(`${method}: the endpoint gave no JSON object`)
  if (answer.id !== id) throw new Error(`${method}: the answer has another id than the request`)
  if (answer.error) throw new Error(`${method}: ${String(answer.error.message ?? 'error')}`)
  return answer.result
}

function short(hash: Hex): string {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  return Promise.race([promise, timeout])
}
