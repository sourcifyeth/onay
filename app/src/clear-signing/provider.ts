// What the clear-signing library asks the app for: token names, chain
// names, address names, block times, and one raw eth_call for the
// attestation check. Each answer that comes from a chain is read through
// the chain gate: with a proof in Helios mode, without one in RPC mode.
// Nothing comes from a third-party API. This module takes the chain
// readers as parameters, so the tests run it as it is.

import type {
  ChainClient,
  ChainInfoResult,
  DescriptorAddressType,
  ExternalDataProvider,
  TokenResult,
} from '@ethereum-sourcify/clear-signing'
import { Interface, ensNormalize, namehash } from 'ethers'
import type { Log } from '../gates/gate.ts'
import type { Hex } from '../messages.ts'

// One chain, as the gates read it.
export type Reader = {
  // True in Helios mode: each answer comes with a proof.
  proof: boolean
  request(method: string, params: unknown[]): Promise<unknown>
}

// The reader of a chain. Null if the chain is not in the settings.
export type Readers = (chainId: number) => Reader | null

// The name and the native currency of a chain. Null if the chain is not
// in the settings, or if its currency is not known.
export type ChainInfo = (chainId: number) => ChainInfoResult | null

export const MAINNET = 1

// ENS lives on mainnet. The registry is the same since 2020.
const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e'

const erc20 = new Interface([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

const ens = new Interface([
  'function resolver(bytes32 node) view returns (address)',
  'function name(bytes32 node) view returns (string)',
  'function addr(bytes32 node) view returns (address)',
])

export function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function proofText(reader: Reader): string {
  return reader.proof ? 'proof checked' : 'no proof'
}

async function call(reader: Reader, to: string, data: string): Promise<Hex> {
  const result = await reader.request('eth_call', [{ to, data }, 'latest'])
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]*$/.test(result)) throw new Error('eth_call gave no data')
  return result as Hex
}

// Token names and symbols do not change, so one read serves the session.
const tokens = new Map<string, Promise<TokenResult | null>>()

async function readToken(reader: Reader, address: string): Promise<TokenResult> {
  const read = async <T>(name: string) => {
    const data = await call(reader, address, erc20.encodeFunctionData(name))
    return erc20.decodeFunctionResult(name, data)[0] as T
  }
  const [tokenName, symbol, decimals] = await Promise.all([
    read<string>('name'),
    read<string>('symbol'),
    read<bigint>('decimals'),
  ])
  return { name: tokenName, symbol, decimals: Number(decimals) }
}

// The reverse record of an address, confirmed by the forward record. A
// name whose forward record points elsewhere is a claim by someone else,
// so it does not count.
export async function reverseName(reader: Reader, address: string): Promise<string | null> {
  const resolverOf = async (node: string) => {
    const data = await call(reader, ENS_REGISTRY, ens.encodeFunctionData('resolver', [node]))
    return ens.decodeFunctionResult('resolver', data)[0] as string
  }
  const node = namehash(`${address.slice(2).toLowerCase()}.addr.reverse`)
  const resolver = await resolverOf(node)
  if (BigInt(resolver) === 0n) return null
  const nameData = await call(reader, resolver, ens.encodeFunctionData('name', [node]))
  const name = ens.decodeFunctionResult('name', nameData)[0] as string
  if (name === '') return null
  const forwardNode = namehash(ensNormalize(name))
  const forwardResolver = await resolverOf(forwardNode)
  if (BigInt(forwardResolver) === 0n) return null
  const addrData = await call(reader, forwardResolver, ens.encodeFunctionData('addr', [forwardNode]))
  const forward = ens.decodeFunctionResult('addr', addrData)[0] as string
  return forward.toLowerCase() === address.toLowerCase() ? name : null
}

const CONTRACT_TYPES: DescriptorAddressType[] = ['contract', 'token', 'collection']
const ACCOUNT_TYPES: DescriptorAddressType[] = ['wallet', 'eoa']

// Whether the address has code, as the descriptor expects. True when the
// descriptor accepts both kinds, or when the code cannot be read.
async function typeMatches(
  reader: Reader | null,
  address: string,
  accepted?: DescriptorAddressType[],
): Promise<boolean> {
  const wantsContract = accepted?.some((type) => CONTRACT_TYPES.includes(type)) ?? false
  const wantsAccount = accepted?.some((type) => ACCOUNT_TYPES.includes(type)) ?? false
  if (wantsContract === wantsAccount || !reader) return true
  try {
    const code = await reader.request('eth_getCode', [address, 'latest'])
    // An EIP-7702 delegation is still an account.
    const isContract = typeof code === 'string' && code !== '0x' && !code.toLowerCase().startsWith('0xef0100')
    return wantsContract ? isContract : !isContract
  } catch {
    return true
  }
}

export function providerFor(chainId: number, readers: Readers, chainInfo: ChainInfo, log: Log): ExternalDataProvider {
  const chainClient: ChainClient = {
    async call(target, { to, data }) {
      const reader = readers(target)
      if (!reader) throw new Error(`chain ${target} is not in the settings`)
      const result = await call(reader, to, data)
      log({
        source: 'erc7730',
        text: `eth_call ${short(to)} on chain ${target} · ${proofText(reader)}`,
        proof: reader.proof,
      })
      return result
    },
  }

  return {
    chainClient,

    async resolveToken(tokenChain, address) {
      const reader = readers(tokenChain)
      if (!reader) return null
      // The proof state is part of the key: a value read without a proof
      // is not the value read with one.
      const key = `${tokenChain}:${address.toLowerCase()}:${reader.proof ? 'proof' : 'no proof'}`
      let token = tokens.get(key)
      if (!token) {
        token = readToken(reader, address).catch(() => null)
        tokens.set(key, token)
      }
      const result = await token
      if (result) {
        const text = `token ${short(address)} · ${result.symbol} · ${result.decimals} decimals · read from chain ${tokenChain} · ${proofText(reader)}`
        log({ source: 'erc7730', text, ok: true, proof: reader.proof })
      } else {
        tokens.delete(key)
        log({ source: 'erc7730', text: `token ${short(address)} · name, symbol or decimals not read`, ok: false })
      }
      return result
    },

    async resolveNftCollectionName(collectionChain, address) {
      const reader = readers(collectionChain)
      if (!reader) return null
      try {
        const data = await call(reader, address, erc20.encodeFunctionData('name'))
        const name = erc20.decodeFunctionResult('name', data)[0] as string
        log({
          source: 'erc7730',
          text: `collection ${short(address)} · ${name} · ${proofText(reader)}`,
          proof: reader.proof,
        })
        return { name }
      } catch {
        log({ source: 'erc7730', text: `collection ${short(address)} · name not read`, ok: false })
        return null
      }
    },

    async resolveBlockTimestamp(blockChain, height) {
      const reader = readers(blockChain)
      if (!reader) return null
      try {
        const block = (await reader.request('eth_getBlockByNumber', [`0x${height.toString(16)}`, false])) as {
          timestamp?: unknown
        } | null
        const timestamp = Number(block?.timestamp)
        if (!Number.isSafeInteger(timestamp)) return null
        log({ source: 'erc7730', text: `block ${height} · ${proofText(reader)}`, proof: reader.proof })
        return { timestamp }
      } catch {
        return null
      }
    },

    resolveChainInfo: async (id) => chainInfo(id),

    async resolveEnsName(address, accepted) {
      const mainnet = readers(MAINNET)
      if (!mainnet) return null
      let name: string | null
      try {
        name = await reverseName(mainnet, address)
      } catch (error) {
        log({ source: 'erc7730', text: `ens ${short(address)} · not read · ${String(error)}`, ok: false })
        return null
      }
      if (name === null) return null
      const typeMatch = await typeMatches(readers(chainId), address, accepted)
      const text = `ens ${short(address)} · ${name} · forward record matches · ${proofText(mainnet)}`
      log({ source: 'erc7730', text, ok: true, proof: mainnet.proof })
      return { name, typeMatch }
    },
  }
}
