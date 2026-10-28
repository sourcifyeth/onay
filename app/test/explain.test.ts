import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ChainConfig } from '../src/chainList.ts'
import { explainHeliosError } from '../src/gates/explain.ts'

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

test('a bootstrap 404 names the consensus endpoint and points to the settings', () => {
  const text = explainHeliosError(BOOTSTRAP_404, CHAIN)
  assert.match(text, /^ethereum-sepolia-beacon-api\.publicnode\.com answered 404 to the light-client bootstrap/)
  assert.match(text, /serves no light-client data/)
  assert.match(text, /consensus endpoint .* in the settings/)
  assert.doesNotMatch(text, /tenderly/)
})

test('a bootstrap that failed another way keeps its message', () => {
  const text = 'sync failed: could not fetch bootstrap: error sending request for url'
  assert.equal(explainHeliosError(text, CHAIN), text)
})

test('the proof errors name the execution endpoint', () => {
  assert.match(
    explainHeliosError('block is out of the proof window', CHAIN),
    /^sepolia\.gateway\.tenderly\.co serves proofs/,
  )
  assert.match(explainHeliosError('archive node required', CHAIN), /^sepolia\.gateway\.tenderly\.co needs a key/)
})

test('any other message passes through', () => {
  assert.equal(explainHeliosError('Helios is behind the chain head', CHAIN), 'Helios is behind the chain head')
})

test('an endpoint that is not a URL is named as it is, without a throw', () => {
  const chain = { ...CHAIN, consensusRpc: 'not a url' }
  assert.match(explainHeliosError(BOOTSTRAP_404, chain), /^not a url answered 404/)
  assert.match(
    explainHeliosError(BOOTSTRAP_404, { ...CHAIN, consensusRpc: undefined }),
    /^the consensus endpoint answered/,
  )
})
