// The address security answer of GoPlus, on real answers (2026-10-27).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { addressSecurity, goPlusText, goPlusUrl, parseGoPlus } from '../src/context/goplus.ts'
import type { Fetch } from '../src/gates/gate.ts'
import type { Hex } from '../src/messages.ts'

const ADDRESS: Hex = '0x098b716b8aaf21512996dc57eb0615e2383e2f96'

const result = (flags: Record<string, string> = {}) => ({
  cybercrime: '0',
  money_laundering: '0',
  number_of_malicious_contracts_created: '0',
  gas_abuse: '0',
  financial_crime: '0',
  darkweb_transactions: '0',
  reinit: '0',
  phishing_activities: '0',
  contract_address: '0',
  fake_kyc: '0',
  blacklist_doubt: '0',
  fake_standard_interface: '0',
  data_source: '',
  stealing_attack: '0',
  blackmail_activities: '0',
  sanctioned: '0',
  malicious_mining_activities: '0',
  mixer: '0',
  fake_token: '0',
  honeypot_related_address: '0',
  ...flags,
})

// The Ronin bridge exploiter.
const flagged = {
  code: 1,
  message: 'ok',
  result: result({ blacklist_doubt: '1', data_source: 'SlowMist,BlockSec', stealing_attack: '1', sanctioned: '1' }),
}

// USDT: `contract_address` says only that it has code.
const clean = { code: 1, message: 'ok', result: result({ contract_address: '1' }) }

test('the set flags in words, with the sources that GoPlus names', () => {
  const parsed = parseGoPlus(flagged)
  assert.deepEqual(
    parsed.flags.map((flag) => flag.text),
    ['stealing attack', 'sanctioned', 'suspected, on a block list'],
  )
  assert.deepEqual(parsed.sources, ['SlowMist', 'BlockSec'])
  assert.equal(
    goPlusText(parsed),
    'stealing attack, sanctioned, suspected, on a block list · according to SlowMist, BlockSec',
  )
})

test('no flags: GoPlus is the source', () => {
  assert.deepEqual(parseGoPlus(clean), { flags: [], sources: ['GoPlus'] })
  assert.equal(goPlusText(parseGoPlus(clean)), 'no flags')
})

test('a count of malicious contracts is a flag; a bad value is left out', () => {
  const parsed = parseGoPlus({ code: 1, result: result({ number_of_malicious_contracts_created: '3', mixer: 'yes' }) })
  assert.deepEqual(
    parsed.flags.map((flag) => flag.text),
    ['created 3 malicious contracts'],
  )
})

test('an error code of GoPlus is an error, not a clean answer', async () => {
  assert.throws(() => parseGoPlus({ code: 4029, message: 'request limit reached', result: null }), /request limit/)
  assert.throws(() => parseGoPlus({ code: 1, message: 'ok' }), /without a result/)
  const limited: Fetch = async () => new Response(JSON.stringify({ code: 4029, message: 'too many requests' }))
  assert.deepEqual(await addressSecurity(1, ADDRESS, limited), { ok: false, reason: 'GoPlus says too many requests' })
})

test('the request: the address and the chain id', async () => {
  const calls: string[] = []
  const fetch: Fetch = async (url) => {
    calls.push(url)
    return new Response(JSON.stringify(flagged))
  }
  const answer = await addressSecurity(1, ADDRESS, fetch)
  assert.equal(answer.ok && answer.value.flags.length, 3)
  assert.deepEqual(calls, [goPlusUrl(1, ADDRESS)])
  assert.equal(calls[0], `https://api.gopluslabs.io/api/v1/address_security/${ADDRESS}?chain_id=1`)
})
