import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_CHAINS, isChainConfig, mergeChains, type ChainConfig } from '../src/chainList.ts'

const mainnet = DEFAULT_CHAINS[0]
const sepolia = DEFAULT_CHAINS[1]

test('nothing saved, or no list: the defaults', () => {
  assert.deepEqual(mergeChains(null), DEFAULT_CHAINS)
  assert.deepEqual(mergeChains('x'), DEFAULT_CHAINS)
  assert.deepEqual(mergeChains([]), DEFAULT_CHAINS)
})

test('Sepolia runs in RPC mode, with a notice, and Helios mode has no notice', () => {
  assert.equal(sepolia.id, 11155111)
  assert.equal(sepolia.mode, 'rpc')
  assert.equal(sepolia.consensusRpc, undefined)
  assert.match(sepolia.notice ?? '', /Helios does not run on Sepolia/)
  for (const chain of DEFAULT_CHAINS) {
    if (chain.mode === 'helios') assert.equal(chain.notice, undefined, chain.name)
  }
})

test('a saved built-in chain keeps the endpoints that the user set, in the same mode', () => {
  const saved: ChainConfig = {
    ...mainnet,
    executionRpc: 'https://my.node/exec',
    consensusRpc: 'https://my.node/beacon',
  }
  assert.deepEqual(mergeChains([saved]), [saved, ...DEFAULT_CHAINS.slice(1)])
})

test('a saved Sepolia in Helios mode, from before the fork, goes to RPC mode', () => {
  const saved: ChainConfig = {
    id: 11155111,
    name: 'Sepolia',
    mode: 'helios',
    executionRpc: 'https://my.node/exec',
    consensusRpc: 'https://ethereum-sepolia-beacon-api.publicnode.com',
  }
  const merged = mergeChains([saved])[1]
  assert.deepEqual(merged, { ...sepolia, executionRpc: 'https://my.node/exec' })
})

test('a built-in chain that goes back to Helios mode takes the consensus endpoint of the defaults', () => {
  const saved: ChainConfig = { id: 1, name: 'Ethereum mainnet', mode: 'rpc', executionRpc: 'https://my.node/exec' }
  assert.deepEqual(mergeChains([saved])[0], { ...mainnet, executionRpc: 'https://my.node/exec' })
})

test('the name and the notice of a built-in chain come from the defaults', () => {
  const saved: ChainConfig = { ...sepolia, name: 'Old name', notice: 'old notice', executionRpc: 'https://x.y/z' }
  const merged = mergeChains([saved])[1]
  assert.equal(merged.name, sepolia.name)
  assert.equal(merged.notice, sepolia.notice)
  assert.equal(merged.executionRpc, 'https://x.y/z')
})

test('custom chains follow the built-in ones; one with a built-in id, or a broken one, is dropped', () => {
  const custom: ChainConfig = { id: 10, name: 'OP Mainnet', mode: 'rpc', executionRpc: 'https://op.x/', custom: true }
  const clash: ChainConfig = { ...sepolia, mode: 'rpc', custom: true }
  const broken = { id: '11', name: 'x', mode: 'rpc', executionRpc: 'https://x/' }
  const wrongMode = { id: 12, name: 'x', mode: 'light', executionRpc: 'https://x/' }
  assert.deepEqual(mergeChains([custom, clash, broken, wrongMode]), [...DEFAULT_CHAINS, custom])
})

test('isChainConfig checks the fields that the app reads', () => {
  assert.equal(isChainConfig(mainnet), true)
  assert.equal(isChainConfig({ ...mainnet, consensusRpc: 5 }), false)
  assert.equal(isChainConfig({ ...mainnet, executionRpc: undefined }), false)
  assert.equal(isChainConfig(null), false)
})
