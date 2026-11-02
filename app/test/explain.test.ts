import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ChainConfig } from '../src/chainList.ts'
import { explainProofError, explainSyncError } from '../src/gates/explain.ts'

const CHAIN: ChainConfig = {
  id: 11155111,
  name: 'Sepolia',
  mode: 'helios',
  executionRpc: 'https://sepolia.gateway.tenderly.co',
  consensusRpc: 'https://ethereum-sepolia-beacon-api.publicnode.com/',
}

// The error of issue #35, as `chain_ready` gives it.
const BOOTSTRAP_404 =
  'sync failed: could not fetch bootstrap: rpc error on method: bootstrap, message: status: 404, message: NOT_FOUND: Sync committee branch for block root 0xdc3c91275a02d9839b4ca15f24fe7eb02c5d53c34c45338d59b1db96f83674e1 not found. This typically occurs when the block is not a finalized checkpoint. Light client bootstrap is only supported for finalized checkpoint block roots.'

// A Lodestar answer for a checkpoint that it has no proof for.
const BOOTSTRAP_500 =
  'sync failed: could not fetch bootstrap: rpc error on method: bootstrap, message: status: 500, message: syncCommitteeWitness not available 0xf3162dcd063f85f5a38d29a826a574eff63ad55938d5e57c82e3021545a5f89e'

test('a bootstrap 404 names the consensus endpoint and points to the settings', () => {
  const text = explainSyncError(BOOTSTRAP_404, CHAIN)
  assert.match(text, /^ethereum-sepolia-beacon-api\.publicnode\.com answered 404 to the light-client bootstrap/)
  assert.match(text, /serves no light-client data/)
  assert.match(text, /consensus endpoint .* in the settings/)
  assert.doesNotMatch(text, /tenderly/)
})

test('another failed bootstrap names the consensus endpoint and keeps the message of Helios', () => {
  const text = explainSyncError(BOOTSTRAP_500, CHAIN)
  assert.match(text, /^ethereum-sepolia-beacon-api\.publicnode\.com did not serve the light-client bootstrap\./)
  assert.match(text, /Check the consensus endpoint in the settings\./)
  assert.ok(text.endsWith(BOOTSTRAP_500))
  assert.doesNotMatch(text, /answered 404/)
})

test('only the status 404 counts as no light-client data, not a 404 or NOT_FOUND in the text', () => {
  const text = 'sync failed: could not fetch bootstrap: status: 500, message: state NOT_FOUND at slot 404'
  assert.match(explainSyncError(text, CHAIN), /did not serve the light-client bootstrap/)
})

test('a connection error of the bootstrap names the consensus endpoint', () => {
  const text = 'sync failed: could not fetch bootstrap: error sending request for url (http://node.example/)'
  assert.match(explainSyncError(text, CHAIN), /^ethereum-sepolia-beacon-api\.publicnode\.com did not serve/)
})

test('a sync error is never blamed on the execution endpoint', () => {
  const chain = { ...CHAIN, consensusRpc: 'https://archive-beacon.example.io' }
  const text =
    'sync failed: could not fetch bootstrap: error sending request for url (https://archive-beacon.example.io/)'
  const explained = explainSyncError(text, chain)
  assert.match(explained, /^archive-beacon\.example\.io did not serve/)
  assert.doesNotMatch(explained, /needs a key|tenderly/)
})

test('a sync error that is not about the bootstrap passes through', () => {
  assert.equal(explainSyncError('Helios is behind the chain head', CHAIN), 'Helios is behind the chain head')
})

test('the proof errors name the execution endpoint', () => {
  assert.match(
    explainProofError('block is out of the proof window', CHAIN),
    /^sepolia\.gateway\.tenderly\.co serves proofs/,
  )
  assert.match(explainProofError('archive node required', CHAIN), /^sepolia\.gateway\.tenderly\.co needs a key/)
})

test('any other read error passes through', () => {
  assert.equal(explainProofError('execution reverted', CHAIN), 'execution reverted')
})

test('an endpoint that is not a URL is named as it is, without a throw', () => {
  assert.match(explainSyncError(BOOTSTRAP_404, { ...CHAIN, consensusRpc: 'not a url' }), /^not a url answered 404/)
  assert.match(
    explainSyncError(BOOTSTRAP_404, { ...CHAIN, consensusRpc: undefined }),
    /^the consensus endpoint answered/,
  )
})
