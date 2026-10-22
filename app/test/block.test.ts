import assert from 'node:assert/strict'
import { test } from 'node:test'

import { blobGasPrice, commonFor, parseHeader } from '../src/gates/block.ts'

const HEADER = {
  number: '0xff',
  timestamp: '0x6900',
  gasLimit: '0x1c9c380',
  baseFeePerGas: '0x3b9aca00',
  miner: '0x9999999999999999999999999999999999999999',
  mixHash: `0x${'ab'.repeat(32)}`,
  excessBlobGas: '0x0',
}

test('parseHeader takes the fields that the EVM reads and refuses others', () => {
  const header = parseHeader(HEADER)
  assert.equal(header.number, 255)
  assert.equal(header.timestamp, 0x6900)
  assert.equal(header.gasLimit, 30_000_000n)
  assert.equal(header.baseFee, 1_000_000_000n)
  assert.equal(header.coinbase, HEADER.miner)
  assert.equal(header.prevRandao, HEADER.mixHash)
  assert.equal(header.excessBlobGas, 0n)
  const bare = parseHeader({ number: '0x1', timestamp: '0x2', gasLimit: '0x3', miner: HEADER.miner })
  assert.equal(bare.baseFee, null)
  assert.equal(bare.prevRandao, `0x${'0'.repeat(64)}`)
  assert.equal(bare.excessBlobGas, null)
  assert.throws(() => parseHeader(null), /unexpected a block/)
  assert.throws(() => parseHeader({ ...HEADER, number: 255 }), /unexpected number/)
  assert.throws(() => parseHeader({ ...HEADER, miner: '0x12' }), /unexpected miner/)
  assert.throws(() => parseHeader({ ...HEADER, gasLimit: undefined }), /unexpected gas limit/)
})

test('blobGasPrice: one wei without excess, more with it', () => {
  assert.equal(blobGasPrice(0n, 5007716n), 1n)
  assert.equal(blobGasPrice(5007716n * 3n, 5007716n), 20n)
})

test('the blob fee fraction comes from the common, and follows the hardfork', () => {
  const common = commonFor(1)
  assert.equal(common.param('blobGasPriceUpdateFraction'), 5007716n)
  common.setHardfork('bpo1')
  assert.equal(common.param('blobGasPriceUpdateFraction'), 8346193n)
})
