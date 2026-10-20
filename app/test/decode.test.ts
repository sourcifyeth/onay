import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Interface } from 'ethers'
import { decodeCalldata, selectorOf, tokenStandard } from '../src/clear-signing/decode.ts'
import type { Hex } from '../src/messages.ts'

const ALICE = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

const ERC20_ABI = [
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function transferFrom(address from, address to, uint256 value) returns (bool)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]

const ERC721_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function approve(address to, uint256 tokenId)',
  'function setApprovalForAll(address operator, bool approved)',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
]

const SWAP_ABI = [
  'function swap(uint256 amountOutMin, address[] path, (uint8 kind, bytes extra) order, bool exact, string note)',
]

// The JSON ABI, as the compiler gives it.
const json = (human: string[]) => JSON.parse(new Interface(human).formatJson()) as unknown[]

test('decodeCalldata names the parameters and renders each value in words', () => {
  const data = new Interface(ERC20_ABI).encodeFunctionData('transfer', [ALICE, 250_000_000n]) as Hex
  const decoded = decodeCalldata(json(ERC20_ABI), data)
  assert.deepEqual(decoded, {
    selector: '0xa9059cbb',
    name: 'transfer',
    signature: 'transfer(address to, uint256 value)',
    params: [
      { name: 'to', type: 'address', value: ALICE },
      { name: 'value', type: 'uint256', value: '250000000' },
    ],
  })
})

test('decodeCalldata renders arrays, tuples, strings, and booleans', () => {
  const contract = new Interface(SWAP_ABI)
  const data = contract.encodeFunctionData('swap', [1n, [ALICE, ALICE], [3, '0x1234'], true, 'hi "there"']) as Hex
  const decoded = decodeCalldata(json(SWAP_ABI), data)
  assert.equal(
    decoded?.signature,
    'swap(uint256 amountOutMin, address[] path, (uint8 kind, bytes extra) order, bool exact, string note)',
  )
  assert.deepEqual(
    decoded?.params.map((param) => param.value),
    ['1', `[${ALICE}, ${ALICE}]`, '{ kind: 3, extra: 0x1234 }', 'true', '"hi \\"there\\""'],
  )
})

test('decodeCalldata gives null for an unknown selector, short calldata, or a broken ABI', () => {
  assert.equal(decodeCalldata(json(ERC20_ABI), '0x12345678'), null)
  assert.equal(decodeCalldata(json(ERC20_ABI), '0xa9059cbb0000'), null)
  assert.equal(decodeCalldata([{ type: 'function', inputs: 'no' }], '0xa9059cbb'), null)
})

test('selectorOf takes the first four bytes', () => {
  assert.equal(selectorOf('0xA9059CBB00'), '0xa9059cbb')
  assert.equal(selectorOf('0xa905'), null)
  assert.equal(selectorOf('0x'), null)
})

test('tokenStandard finds the functions of ERC-20 and ERC-721', () => {
  assert.equal(tokenStandard(json(ERC20_ABI)), 'erc20')
  assert.equal(tokenStandard(json(ERC721_ABI)), 'erc721')
  assert.equal(tokenStandard(json([...ERC20_ABI, 'function name() view returns (string)'])), 'erc20')
  assert.equal(tokenStandard(json(ERC20_ABI.slice(1))), null)
  assert.equal(tokenStandard(json(SWAP_ABI)), null)
  assert.equal(tokenStandard([{ type: 'function', inputs: 'no' }]), null)
})
