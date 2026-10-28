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

test('the Ethereum chains run in Helios mode, each with a consensus endpoint', () => {
  for (const chain of [mainnet, sepolia, DEFAULT_CHAINS[2]]) {
    assert.equal(chain.mode, 'helios', chain.name)
    assert.match(chain.consensusRpc ?? '', /^https:\/\//, chain.name)
  }
})

test('a saved built-in chain keeps the endpoints that the user set', () => {
  const saved: ChainConfig = {
    ...mainnet,
    executionRpc: 'https://my.node/exec',
    consensusRpc: 'https://my.node/beacon',
  }
  assert.deepEqual(mergeChains([saved]), [saved, ...DEFAULT_CHAINS.slice(1)])
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
