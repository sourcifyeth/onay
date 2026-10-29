// The Etherscan claims of the profile: the creation and the first
// transaction, with the key of the user only.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  creation,
  creationUrl,
  parseCreation,
  parseTransactions,
  transactions,
  txlistUrl,
} from '../src/context/etherscan.ts'
import type { Fetch } from '../src/gates/gate.ts'
import type { Hex } from '../src/messages.ts'

const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678'
const USDT: Hex = '0xdac17f958d2ee523a2206206994597c13d831ec7'
const HASH = '0x2f1c5c2b44f771e942a8506148e256f94f1a464babc938ae0690c6e34cd79190'

// The shapes of the Etherscan API V2 documentation.
const created = {
  status: '1',
  message: 'OK',
  result: [
    {
      contractAddress: USDT,
      contractCreator: '0x36928500Bc1dCd7af6a2B4008875CC336b927D57',
      txHash: HASH,
      blockNumber: '4634748',
      timestamp: '1511829681',
      contractFactory: '',
      creationBytecode: '0x6060',
    },
  ],
}

const txlist = {
  status: '1',
  message: 'OK',
  result: [{ blockNumber: '4634748', timeStamp: '1511829681', hash: HASH, from: '0x3692', to: '' }],
}

test('getcontractcreation: the deployer, the hash, the block and the time', () => {
  assert.deepEqual(parseCreation(created), {
    deployer: '0x36928500bc1dcd7af6a2b4008875cc336b927d57',
    transactionHash: HASH,
    block: 4634748,
    time: 1511829681000,
  })
  assert.equal(parseCreation({ status: '0', message: 'No data found', result: null }), null)
  assert.throws(() => parseCreation({ status: '1', message: 'OK', result: [{ txHash: 'x' }] }), /does not read/)
})

test('txlist: the first transaction, or none', () => {
  assert.deepEqual(parseTransactions(txlist), { hash: HASH, block: 4634748, time: 1511829681000 })
  assert.equal(parseTransactions({ status: '0', message: 'No transactions found', result: [] }), null)
})

test('the errors of Etherscan give a reason, a rate limit is marked', async () => {
  const answer =
    (result: string): Fetch =>
    async () =>
      new Response(JSON.stringify({ status: '0', message: 'NOTOK', result }), { status: 200 })
  assert.deepEqual(await creation(1, USDT, KEY, answer('Missing/Invalid API Key')), {
    ok: false,
    reason: 'the API key is missing or not valid',
  })
  assert.deepEqual(await transactions(1, USDT, KEY, answer('Max calls per sec rate limit reached (3/sec)')), {
    ok: false,
    reason: 'rate limited',
    limited: true,
  })
  assert.deepEqual(
    await creation(8453, USDT, KEY, answer('Free API access is not supported for this chain. Please upgrade')),
    { ok: false, reason: 'this chain needs a paid plan' },
  )
  const server: Fetch = async () => new Response('', { status: 502 })
  assert.deepEqual(await creation(1, USDT, KEY, server), { ok: false, reason: 'HTTP 502' })
})

test('without a key, no request goes out', async () => {
  const calls: string[] = []
  const fetch: Fetch = async (url) => {
    calls.push(url)
    return new Response(JSON.stringify(created))
  }
  assert.equal((await creation(1, USDT, ' ', fetch)).ok, false)
  assert.equal((await transactions(1, USDT, '', fetch)).ok, false)
  assert.deepEqual(calls, [])
  assert.equal((await creation(1, USDT, KEY, fetch)).ok, true)
  assert.equal(calls.length, 1)
})

test('the URLs: the chain id, the action, and the key', () => {
  assert.equal(
    creationUrl(10, USDT, KEY),
    `https://api.etherscan.io/v2/api?chainid=10&module=contract&action=getcontractcreation&contractaddresses=${USDT}&apikey=${KEY}`,
  )
  assert.match(txlistUrl(1, USDT, KEY), /action=txlist&address=0xdac1.*&page=1&offset=1&sort=asc&apikey=/)
})
