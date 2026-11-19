// The effects with the real EVM on a fake chain: a token, an NFT, a pool
// and a contract that emits a false event, compiled by the real
// compiler. The probes run on the state before and after the run.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AbiCoder, Interface, keccak256 } from 'ethers'
import type { ChainConfig } from '../src/chains.ts'
import type { Hex } from '../src/messages.ts'
import type { ChainRead } from '../src/gates/helios.ts'
import type { Call } from '../src/gates/request.ts'
import { simulationGateFor, type Simulation } from '../src/gates/simulation.ts'
import { compile } from './solc.ts'

const YOU: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const ALICE: Hex = '0xa11ce00000000000000000000000000000000001'
const TOKEN: Hex = '0x1000000000000000000000000000000000000001'
const NFT: Hex = '0x2000000000000000000000000000000000000002'
const POOL: Hex = '0x3000000000000000000000000000000000000003'
const CLAIM: Hex = '0x4000000000000000000000000000000000000004'
const DRAINER: Hex = '0x5000000000000000000000000000000000000005'
const MAX = (1n << 256n) - 1n

const SOURCE = `
pragma solidity 0.8.24;
contract Token {
  mapping(address => uint) public balanceOf;
  mapping(address => mapping(address => uint)) public allowance;
  string public constant symbol = "TKN";
  string public constant name = "Test Token";
  uint8 public constant decimals = 6;
  event Transfer(address indexed from, address indexed to, uint value);
  event Approval(address indexed owner, address indexed spender, uint value);
  function transfer(address to, uint v) external returns (bool) {
    balanceOf[msg.sender] -= v;
    balanceOf[to] += v;
    emit Transfer(msg.sender, to, v);
    return true;
  }
  function approve(address spender, uint v) external returns (bool) {
    allowance[msg.sender][spender] = v;
    emit Approval(msg.sender, spender, v);
    return true;
  }
}
contract Nft {
  mapping(uint => address) public ownerOf;
  mapping(address => uint) public balanceOf;
  mapping(address => mapping(address => bool)) public isApprovedForAll;
  event Transfer(address indexed from, address indexed to, uint indexed id);
  event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
  function transferFrom(address from, address to, uint id) external {
    require(ownerOf[id] == from && msg.sender == from, "not yours");
    ownerOf[id] = to;
    balanceOf[from]--;
    balanceOf[to]++;
    emit Transfer(from, to, id);
  }
  function setApprovalForAll(address operator, bool approved) external {
    isApprovedForAll[msg.sender][operator] = approved;
    emit ApprovalForAll(msg.sender, operator, approved);
  }
}
contract Pool {
  function swap() external payable { Token(${TOKEN}).transfer(msg.sender, msg.value * 2); }
}
contract Claim {
  event Transfer(address indexed from, address indexed to, uint value);
  function claim() external { emit Transfer(address(0), msg.sender, 5000000000); }
}
`

const contracts = compile(SOURCE)
const coder = AbiCoder.defaultAbiCoder()
const abi = new Interface([
  'function transfer(address,uint256)',
  'function approve(address,uint256)',
  'function transferFrom(address,address,uint256)',
  'function setApprovalForAll(address,bool)',
  'function swap()',
  'function claim()',
])
const input = (fn: string, args: unknown[] = []) => abi.encodeFunctionData(fn, args) as Hex

// The slot of a mapping entry: keccak256 of the key and the slot.
const slotOf = (key: Hex | bigint, slot: bigint) =>
  keccak256(coder.encode([typeof key === 'bigint' ? 'uint256' : 'address', 'uint256'], [key, slot])) as Hex
const word = (value: bigint | Hex) =>
  `0x${(typeof value === 'bigint' ? value.toString(16) : value.slice(2)).padStart(64, '0')}`

const EMPTY_CODE_HASH = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
const EMPTY_ROOT = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421'
const HEADER = {
  number: '0xff',
  timestamp: '0x6900',
  gasLimit: '0x1c9c380',
  baseFeePerGas: '0x3b9aca00',
  miner: '0x9999999999999999999999999999999999999999',
  mixHash: `0x${'ab'.repeat(32)}`,
  excessBlobGas: '0x0',
}

// You hold 1,000 TKN and NFT 7, the pool holds 1,000,000 TKN. A read
// that `fail` names rejects.
async function chain(fail?: (method: string, params: unknown[]) => boolean): Promise<ChainRead> {
  const { Token, Nft, Pool, Claim } = await contracts
  const code: Record<string, Hex> = {
    [TOKEN]: Token.runtime,
    [NFT]: Nft.runtime,
    [POOL]: Pool.runtime,
    [CLAIM]: Claim.runtime,
  }
  const storage: Record<string, string> = {
    [`${TOKEN} ${slotOf(YOU, 0n)}`]: word(1000n),
    [`${TOKEN} ${slotOf(POOL, 0n)}`]: word(1_000_000n),
    [`${NFT} ${slotOf(7n, 0n)}`]: word(YOU),
    [`${NFT} ${slotOf(YOU, 1n)}`]: word(1n),
  }
  return async (method, params) => {
    if (fail?.(method, params)) throw new Error('HTTP 429')
    const address = String(params[0]).toLowerCase()
    switch (method) {
      case 'eth_getBlockByNumber':
        return HEADER
      case 'eth_getProof':
        if (address === YOU)
          return { nonce: '0x5', balance: '0xde0b6b3a7640000', codeHash: EMPTY_CODE_HASH, storageHash: EMPTY_ROOT }
        if (code[address])
          return { nonce: '0x1', balance: '0x0', codeHash: `0x${'01'.repeat(32)}`, storageHash: EMPTY_ROOT }
        return { nonce: '0x0', balance: '0x0', codeHash: EMPTY_CODE_HASH, storageHash: EMPTY_ROOT }
      case 'eth_getCode':
        return code[address] ?? '0x'
      case 'eth_getStorageAt':
        return storage[`${address} ${params[1]}`] ?? word(0n)
      default:
        throw new Error(`${method} not expected`)
    }
  }
}

const RPC: ChainConfig = { id: 1, name: 'test', mode: 'rpc', executionRpc: 'http://chain.invalid' }
const call = (to: Hex, data: Hex, value = 0n): Call => ({ from: YOU, to, data, value, gas: null })

async function simulate(calls: Call[], read?: ChainRead): Promise<Simulation> {
  return simulationGateFor(RPC, read ?? (await chain())).run({ calls, block: 255 }, () => {})
}

function effects(simulation: Simulation) {
  assert.equal(simulation.effects.status, 'passed')
  if (simulation.effects.status !== 'passed') throw new Error('no effects')
  return simulation.effects.value
}

test('a swap: the ETH out, the token in, and what the token says about itself', async () => {
  const simulation = await simulate([call(POOL, input('swap'), 1000n)])
  const result = effects(simulation)
  assert.deepEqual(result.assets, [
    { asset: { kind: 'native' }, delta: -1000n },
    { asset: { kind: 'erc20', token: TOKEN }, delta: 2000n },
  ])
  assert.deepEqual(result.tokens[TOKEN], { symbol: 'TKN', name: 'Test Token', decimals: 6 })
  assert.deepEqual(result.warnings, [])
  // The diff: your nonce and ETH, the ETH of the pool, two balances of the token.
  const { accounts, slots } = simulation.diff
  assert.deepEqual(
    accounts.map(({ address }) => address),
    [YOU, POOL],
  )
  assert.equal(accounts[0].nonce.after, 6n)
  assert.deepEqual(
    slots.map(({ address, slot, before, after }) => [address, slot, BigInt(before), BigInt(after)]),
    [
      [TOKEN, slotOf(POOL, 0n), 1_000_000n, 998_000n],
      [TOKEN, slotOf(YOU, 0n), 1000n, 3000n],
    ],
  )
  // The events of the run, as the chain gives them.
  assert.equal(simulation.calls[0].logs.length, 1)
  assert.equal(simulation.calls[0].logs[0].address, TOKEN)
})

test('a token transfer: the amount out, and the receiver', async () => {
  const simulation = await simulate([call(TOKEN, input('transfer', [ALICE, 250n]))])
  assert.deepEqual(effects(simulation).assets, [
    { asset: { kind: 'erc20', token: TOKEN }, delta: -250n, counterparty: ALICE },
  ])
})

test('an unlimited approval: the allowance before and after, and your balance', async () => {
  const simulation = await simulate([call(TOKEN, input('approve', [DRAINER, MAX]))])
  const result = effects(simulation)
  assert.deepEqual(result.assets, [])
  assert.deepEqual(result.permissions, [
    { token: TOKEN, spender: DRAINER, kind: 'amount', before: 0n, after: MAX, balance: 1000n },
  ])
})

test('an NFT sent to alice: the owner before and after', async () => {
  const simulation = await simulate([call(NFT, input('transferFrom', [YOU, ALICE, 7n]))])
  assert.deepEqual(effects(simulation).assets, [
    { asset: { kind: 'nft', standard: 'erc721', token: NFT, id: 7n }, delta: -1n, counterparty: ALICE },
  ])
})

test('a batch: a false event and an approval for all the NFTs', async () => {
  const simulation = await simulate([
    call(CLAIM, input('claim')),
    call(NFT, input('setApprovalForAll', [DRAINER, true])),
  ])
  const result = effects(simulation)
  assert.deepEqual(result.assets, [])
  assert.deepEqual(result.warnings, [{ token: CLAIM, direction: 'in', amount: 5_000_000_000n, id: null }])
  assert.deepEqual(result.permissions, [
    { token: NFT, spender: DRAINER, kind: 'all', before: 0n, after: 1n, balance: 1n },
  ])
  assert.deepEqual(result.tokens[CLAIM], { symbol: null, name: null, decimals: null })
})

test('a revert: no effects, and no events', async () => {
  const simulation = await simulate([call(NFT, input('transferFrom', [ALICE, YOU, 7n]))])
  assert.deepEqual(simulation.effects, { status: 'skipped', reason: 'the transaction reverts' })
  assert.deepEqual(simulation.calls[0].logs, [])
  assert.equal(simulation.calls[0].error, 'not yours')
})

test('the fee: the gas of the chain at the base fee, or at the price of the request', async () => {
  const plain = await simulate([call(TOKEN, input('transfer', [ALICE, 250n]))])
  // A token transfer to a new holder: well above 21,000, below 60,000.
  assert.ok(plain.fee.gas > 40_000n && plain.fee.gas < 60_000n, String(plain.fee.gas))
  assert.deepEqual(
    { price: plain.fee.price, fromRequest: plain.fee.fromRequest },
    { price: 10n ** 9n, fromRequest: false },
  )
  const priced = await simulate([
    {
      ...call(TOKEN, input('transfer', [ALICE, 250n])),
      fees: { maxFeePerGas: 5n * 10n ** 9n, maxPriorityFeePerGas: 10n ** 9n },
    },
  ])
  assert.deepEqual(
    { price: priced.fee.price, fromRequest: priced.fee.fromRequest },
    { price: 2n * 10n ** 9n, fromRequest: true },
  )
  assert.equal(priced.fee.gas, plain.fee.gas)
})

test('a gas limit below the intrinsic gas fails the gate', async () => {
  await assert.rejects(
    simulate([{ ...call(TOKEN, input('transfer', [ALICE, 250n])), gas: 21_000n }]),
    /below the intrinsic gas/,
  )
})

test('a probe that cannot read the chain: the effects fail, the call tree holds', async () => {
  // The run of approve never reads your balance. The probe does, and fails.
  const balance = slotOf(YOU, 0n)
  const read = await chain((method, params) => method === 'eth_getStorageAt' && params[1] === balance)
  const simulation = await simulate([call(TOKEN, input('approve', [DRAINER, MAX]))], read)
  assert.deepEqual(simulation.effects, { status: 'failed', reason: 'HTTP 429' })
  assert.equal(simulation.calls[0].error, null)
  assert.deepEqual(
    simulation.touched.map(({ address }) => address),
    [TOKEN],
  )
})
