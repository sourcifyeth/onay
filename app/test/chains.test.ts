import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_CHAINS, isExplorerField, loadChains, type ChainConfig } from '../src/chainList.ts'

const mainnet = DEFAULT_CHAINS[0]

test('a fresh install has the built-in chains with their explorers', () => {
  const chains = loadChains(null)
  assert.deepEqual(chains, DEFAULT_CHAINS)
  assert.equal(mainnet.etherscan, 'https://etherscan.io')
  assert.equal(mainnet.blockscout, 'https://eth.blockscout.com')
  assert.deepEqual(
    chains.map((chain) => [chain.id, chain.etherscan, chain.blockscout]),
    [
      [1, 'https://etherscan.io', 'https://eth.blockscout.com'],
      [11155111, 'https://sepolia.etherscan.io', 'https://eth-sepolia.blockscout.com'],
      [560048, 'https://hoodi.etherscan.io', 'https://eth-hoodi.blockscout.com'],
      [42161, 'https://arbiscan.io', 'https://arbitrum.blockscout.com'],
    ],
  )
})

test('the chains survive a reload', () => {
  const edited: ChainConfig = { ...mainnet, executionRpc: 'https://my.node', blockscout: 'https://scout.example' }
  const custom: ChainConfig = {
    id: 777,
    name: 'Mine',
    mode: 'rpc',
    executionRpc: 'https://rpc.mine',
    custom: true,
    blockscout: 'https://scout.mine',
    blockscoutApi: 'https://api.scout.mine',
  }
  const chains = loadChains(JSON.stringify([edited, custom]))
  assert.deepEqual(chains[0], edited)
  assert.deepEqual(chains.at(-1), custom)
  assert.equal(chains.length, DEFAULT_CHAINS.length + 1)
})

test('an older save without the explorer fields gets the defaults', () => {
  const old: Partial<ChainConfig> = { ...mainnet }
  delete old.etherscan
  delete old.blockscout
  const chains = loadChains(JSON.stringify([{ ...old, executionRpc: 'https://my.node' }]))
  assert.equal(chains[0].executionRpc, 'https://my.node')
  assert.equal(chains[0].etherscan, 'https://etherscan.io')
  assert.equal(chains[0].blockscout, 'https://eth.blockscout.com')
})

test('an explorer that the user turned off stays off', () => {
  const chains = loadChains(JSON.stringify([{ ...mainnet, etherscan: '' }]))
  assert.equal(chains[0].etherscan, '')
  assert.equal(chains[0].blockscout, 'https://eth.blockscout.com')
})

test('a bad explorer value is dropped, not the chain', () => {
  const custom = { id: 777, name: 'Mine', mode: 'rpc', executionRpc: 'https://rpc.mine', custom: true }
  const chains = loadChains(
    JSON.stringify([
      { ...mainnet, etherscan: 'http://etherscan.io', blockscout: 42 },
      { ...custom, blockscout: 'javascript:alert(1)', blockscoutApi: 'https://api.scout.mine' },
    ]),
  )
  // The built-in chain gets its defaults back.
  assert.equal(chains[0].etherscan, 'https://etherscan.io')
  assert.equal(chains[0].blockscout, 'https://eth.blockscout.com')
  const mine = chains.at(-1)!
  assert.equal(mine.id, 777)
  assert.equal(mine.blockscout, undefined)
  assert.equal(mine.blockscoutApi, 'https://api.scout.mine')
})

test('a bad save gives the defaults', () => {
  assert.deepEqual(loadChains('not json'), DEFAULT_CHAINS)
  assert.deepEqual(loadChains('{"id":1}'), DEFAULT_CHAINS)
  assert.deepEqual(loadChains('[{"id":"1"}, null, 5]'), DEFAULT_CHAINS)
})

test('isExplorerField takes an empty value or an https URL', () => {
  assert.ok(isExplorerField(''))
  assert.ok(isExplorerField('https://scout.example'))
  assert.ok(!isExplorerField('http://scout.example'))
  assert.ok(!isExplorerField('scout.example'))
  assert.ok(!isExplorerField('https://a b'))
})
